import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import crypto from 'crypto';
import { AdapterError, toHttpsError } from './utils/errors';
import { fetchJson } from './utils/http';
import { generateSignedUrl } from './utils/signedUrl';
import { assertMimeAllowed, isImageMime, isVideoMime, sanitizeText } from './utils/validators';
import {
  assertAgencyClientAccess,
  assertAuthed,
  assertRole,
  ensureAgencyMatch,
  getAssetsByIds,
  getPlatformVariants,
  getUserProfile,
} from './security/authz';
import { assertTenantIds } from './security/tenants';
import { accessToken, deleteToken, storeToken, StoredToken } from './tokens/tokenStore';
import * as metaAdapter from './adapters/meta';
import * as ytAdapter from './adapters/youtube';
import * as tikTokAdapter from './adapters/tiktok';
import * as driveAdapter from './adapters/drive';

initializeApp();

const db = getFirestore();
const storage = getStorage().bucket();

const FRONTEND_SUCCESS_URL = process.env.FRONTEND_SUCCESS_URL ?? '';

const requiredSecrets = {
  meta: ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI'],
  youtube: ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REDIRECT_URI'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'],
  drive: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
};

type Platform = 'meta' | 'youtube' | 'tiktok' | 'drive';

type PostPlatform = 'facebook' | 'instagram' | 'youtube' | 'tiktok';

const validateEnv = (platform: Platform) => {
  const missing = requiredSecrets[platform].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new HttpsError('failed-precondition', `Missing ${missing.join(', ')}`);
  }
};

const buildAuthUrl = (platform: Platform, state: string) => {
  switch (platform) {
    case 'meta':
      return (
        `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.META_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI ?? '')}` +
        `&state=${encodeURIComponent(state)}` +
        `&scope=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish`
      );
    case 'youtube':
      return (
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.YT_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.YT_REDIRECT_URI ?? '')}` +
        `&response_type=code&access_type=offline&prompt=consent` +
        `&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly')}` +
        `&state=${encodeURIComponent(state)}`
      );
    case 'tiktok':
      return (
        `https://www.tiktok.com/v2/auth/authorize/?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
        `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI ?? '')}` +
        `&response_type=code&scope=${encodeURIComponent('user.info.basic,video.publish')}` +
        `&state=${encodeURIComponent(state)}`
      );
    case 'drive':
      return (
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI ?? '')}` +
        `&response_type=code&access_type=offline&prompt=consent` +
        `&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.readonly')}` +
        `&state=${encodeURIComponent(state)}`
      );
    default:
      throw new HttpsError('invalid-argument', 'Unsupported platform');
  }
};

const createState = async (agencyId: string, clientId: string, platform: Platform) => {
  const nonce = crypto.randomUUID();
  const payload = { agencyId, clientId, platform, nonce };
  const state = Buffer.from(JSON.stringify(payload)).toString('base64url');
  await db.doc(`oauthStates/${nonce}`).set({
    agencyId,
    clientId,
    platform,
    nonce,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
  });
  return state;
};

const parseState = async (state?: string) => {
  if (!state) {
    throw new HttpsError('invalid-argument', 'Missing state');
  }
  const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
    agencyId: string;
    clientId: string;
    platform: Platform;
    nonce: string;
  };
  const doc = await db.doc(`oauthStates/${decoded.nonce}`).get();
  if (!doc.exists) {
    throw new HttpsError('invalid-argument', 'Invalid OAuth state');
  }
  const data = doc.data();
  if (!data?.expiresAt || data.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError('failed-precondition', 'OAuth state expired');
  }
  return decoded;
};

const exchangeToken = async (platform: Platform, code: string) => {
  validateEnv(platform);
  switch (platform) {
    case 'meta': {
      const response = await fetchJson<{ access_token?: string; token_type?: string; error?: { message: string } }>(
        `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${process.env.META_APP_ID}` +
          `&client_secret=${process.env.META_APP_SECRET}` +
          `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI ?? '')}` +
          `&code=${encodeURIComponent(code)}`,
      );
      if (response.status >= 400 || response.data.error || !response.data.access_token) {
        throw new HttpsError('failed-precondition', response.data.error?.message ?? 'Meta token exchange failed');
      }
      return {
        access_token: response.data.access_token,
        token_type: response.data.token_type,
      } as StoredToken;
    }
    case 'youtube': {
      const body = new URLSearchParams({
        code,
        client_id: process.env.YT_CLIENT_ID ?? '',
        client_secret: process.env.YT_CLIENT_SECRET ?? '',
        redirect_uri: process.env.YT_REDIRECT_URI ?? '',
        grant_type: 'authorization_code',
      });
      const response = await fetchJson<StoredToken & { error?: string }>('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (response.status >= 400 || response.data.error || !response.data.access_token) {
        throw new HttpsError('failed-precondition', response.data.error ?? 'YouTube token exchange failed');
      }
      return response.data;
    }
    case 'tiktok': {
      const response = await fetchJson<StoredToken & { error?: { message?: string } }>(
        'https://open.tiktokapis.com/v2/oauth/token/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
            client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
            code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.TIKTOK_REDIRECT_URI ?? '',
          }).toString(),
        },
      );
      if (response.status >= 400 || response.data.error || !response.data.access_token) {
        throw new HttpsError('failed-precondition', response.data.error?.message ?? 'TikTok token exchange failed');
      }
      return response.data;
    }
    case 'drive': {
      const response = await fetchJson<StoredToken & { error?: string }>('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (response.status >= 400 || response.data.error || !response.data.access_token) {
        throw new HttpsError('failed-precondition', response.data.error ?? 'Drive token exchange failed');
      }
      return response.data;
    }
    default:
      throw new HttpsError('invalid-argument', 'Unsupported platform');
  }
};

const refreshGoogleToken = async (refreshToken: string, platform: 'youtube' | 'drive') => {
  validateEnv(platform);
  const clientId = platform === 'youtube' ? process.env.YT_CLIENT_ID : process.env.GOOGLE_CLIENT_ID;
  const clientSecret = platform === 'youtube' ? process.env.YT_CLIENT_SECRET : process.env.GOOGLE_CLIENT_SECRET;
  const response = await fetchJson<StoredToken & { error?: string }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (response.status >= 400 || response.data.error || !response.data.access_token) {
    throw new HttpsError('failed-precondition', response.data.error ?? 'Token refresh failed');
  }
  return response.data;
};

const getValidAccessToken = async (platform: Platform, tokenRefKey: string): Promise<string> => {
  const token = await accessToken(tokenRefKey);
  const expiresIn = token.expires_in ?? 0;
  if (!expiresIn || !token.obtained_at) {
    return token.access_token;
  }
  const expiry = token.obtained_at + expiresIn * 1000 - 60000;
  if (Date.now() < expiry) {
    return token.access_token;
  }
  if (platform === 'youtube' || platform === 'drive') {
    if (!token.refresh_token) {
      throw new HttpsError('failed-precondition', 'Missing refresh token');
    }
    const refreshed = await refreshGoogleToken(token.refresh_token, platform);
    const newToken: StoredToken = {
      ...token,
      ...refreshed,
      obtained_at: Date.now(),
    };
    await storeToken(tokenRefKey.split('/').pop() ?? tokenRefKey, newToken);
    return newToken.access_token;
  }
  return token.access_token;
};

const createConnectionRef = (agencyId: string, clientId: string, platform: Platform) =>
  db.collection(`agencies/${agencyId}/clients/${clientId}/connections`).doc(platform);

export const oauthStart = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, platform } = request.data as {
      agencyId: string;
      clientId: string;
      platform: Platform;
    };
    assertTenantIds(agencyId, clientId);
    validateEnv(platform);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);
    const state = await createState(agencyId, clientId, platform);
    const authUrl = buildAuthUrl(platform, state);
    return { authUrl };
  } catch (error) {
    toHttpsError(error);
  }
});

const handleOAuthCallback = async (platform: Platform, code?: string, state?: string) => {
  if (!code) {
    throw new HttpsError('invalid-argument', 'Missing code');
  }
  const parsed = await parseState(state);
  if (parsed.platform !== platform) {
    throw new HttpsError('invalid-argument', 'Platform mismatch');
  }
  const token = await exchangeToken(platform, code);
  token.obtained_at = Date.now();
  const secretId = `aurasocial-${platform}-${parsed.agencyId}-${parsed.clientId}-${crypto.randomUUID()}`;
  const secretName = await storeToken(secretId, token);

  let accountId = '';
  let displayName = '';
  let scopes: string[] = [];
  let igBusinessId: string | undefined;

  if (platform === 'meta') {
    const pages = await metaAdapter.listPages(token.access_token);
    if (!pages.length) {
      throw new HttpsError('failed-precondition', 'No pages available');
    }
    const first = pages[0];
    accountId = first.id;
    displayName = first.name;
    igBusinessId = first.instagram_business_account?.id;
    scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'];
  }

  if (platform === 'youtube') {
    const channels = await ytAdapter.listChannels(token.access_token);
    if (!channels.length) {
      throw new HttpsError('failed-precondition', 'No YouTube channels found');
    }
    accountId = channels[0].id;
    displayName = channels[0].snippet.title;
    scopes = ['youtube.upload', 'youtube.readonly'];
  }

  if (platform === 'tiktok') {
    const user = await tikTokAdapter.getUserInfo(token.access_token);
    accountId = user.open_id;
    displayName = user.display_name ?? 'TikTok User';
    scopes = ['user.info.basic', 'video.publish'];
  }

  if (platform === 'drive') {
    const user = await driveAdapter.getDriveUser(token.access_token);
    accountId = user?.permissionId ?? '';
    displayName = user?.displayName ?? 'Drive User';
    scopes = ['drive.readonly'];
  }

  await createConnectionRef(parsed.agencyId, parsed.clientId, platform).set(
    {
      platform,
      status: 'connected',
      displayName,
      accountId,
      igBusinessId: igBusinessId ?? null,
      scopes,
      tokenRefKey: secretName,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { agencyId: parsed.agencyId, clientId: parsed.clientId, platform };
};

const redirectSuccess = (response: Parameters<typeof onRequest>[0]['response'], platform: Platform, clientId: string) => {
  if (FRONTEND_SUCCESS_URL) {
    response.redirect(`${FRONTEND_SUCCESS_URL}?platform=${platform}&clientId=${clientId}`);
    return;
  }
  response.status(200).send('OAuth connected.');
};

export const oauthCallbackMeta = onRequest(async (req, res) => {
  try {
    const result = await handleOAuthCallback('meta', req.query.code as string, req.query.state as string);
    redirectSuccess(res, 'meta', result.clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth error';
    res.status(400).send(message);
  }
});

export const oauthCallbackYouTube = onRequest(async (req, res) => {
  try {
    const result = await handleOAuthCallback('youtube', req.query.code as string, req.query.state as string);
    redirectSuccess(res, 'youtube', result.clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth error';
    res.status(400).send(message);
  }
});

export const oauthCallbackTikTok = onRequest(async (req, res) => {
  try {
    const result = await handleOAuthCallback('tiktok', req.query.code as string, req.query.state as string);
    redirectSuccess(res, 'tiktok', result.clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth error';
    res.status(400).send(message);
  }
});

export const oauthCallbackDrive = onRequest(async (req, res) => {
  try {
    const result = await handleOAuthCallback('drive', req.query.code as string, req.query.state as string);
    redirectSuccess(res, 'drive', result.clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth error';
    res.status(400).send(message);
  }
});

export const metaListPages = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId } = request.data as { agencyId: string; clientId: string };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);
    const connection = await createConnectionRef(agencyId, clientId, 'meta').get();
    const tokenRefKey = connection.data()?.tokenRefKey as string | undefined;
    if (!tokenRefKey) {
      throw new HttpsError('failed-precondition', 'Meta connection missing');
    }
    const token = await getValidAccessToken('meta', tokenRefKey);
    const pages = await metaAdapter.listPages(token);
    return {
      pages: pages.map((page) => ({
        pageId: page.id,
        name: page.name,
        hasIG: !!page.instagram_business_account?.id,
        igBusinessId: page.instagram_business_account?.id,
      })),
    };
  } catch (error) {
    toHttpsError(error);
  }
});

export const metaSelectPage = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, pageId } = request.data as { agencyId: string; clientId: string; pageId: string };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);
    const connection = await createConnectionRef(agencyId, clientId, 'meta').get();
    const tokenRefKey = connection.data()?.tokenRefKey as string | undefined;
    if (!tokenRefKey) {
      throw new HttpsError('failed-precondition', 'Meta connection missing');
    }
    const token = await getValidAccessToken('meta', tokenRefKey);
    const details = await metaAdapter.getPageDetails(pageId, token);
    await createConnectionRef(agencyId, clientId, 'meta').set(
      {
        accountId: pageId,
        igBusinessId: details.instagram_business_account?.id ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { connected: true };
  } catch (error) {
    toHttpsError(error);
  }
});

export const disconnectPlatform = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, platform } = request.data as {
      agencyId: string;
      clientId: string;
      platform: Platform;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);

    const connectionRef = createConnectionRef(agencyId, clientId, platform);
    const connectionDoc = await connectionRef.get();
    const tokenRefKey = connectionDoc.data()?.tokenRefKey as string | undefined;

    if (tokenRefKey) {
      if (platform === 'youtube' || platform === 'drive') {
        const token = await accessToken(tokenRefKey);
        if (token.access_token) {
          await fetchJson<Record<string, unknown>>('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: token.access_token }).toString(),
          });
        }
      }
      if (platform === 'tiktok') {
        const token = await accessToken(tokenRefKey);
        await fetchJson<Record<string, unknown>>('https://open.tiktokapis.com/v2/oauth/revoke/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ access_token: token.access_token }).toString(),
        });
      }
      await deleteToken(tokenRefKey);
    }

    await connectionRef.set(
      {
        status: 'disconnected',
        tokenRefKey: null,
        accountId: null,
        displayName: null,
        igBusinessId: null,
        scopes: [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const schedules = await db
      .collectionGroup('schedules')
      .where('status', 'in', ['scheduled', 'pending'])
      .get();
    const batch = db.batch();
    schedules.docs.forEach((doc) => {
      const data = doc.data();
      if (data.platform === platform) {
        batch.update(doc.ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
      }
    });
    await batch.commit();

    return { disconnected: true };
  } catch (error) {
    toHttpsError(error);
  }
});

export const driveImportStart = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, folderId, fileId } = request.data as {
      agencyId: string;
      clientId: string;
      folderId?: string;
      fileId?: string;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Editor', 'Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);
    if (!folderId && !fileId) {
      throw new HttpsError('invalid-argument', 'Missing folderId or fileId');
    }
    const jobRef = await db.collection(`agencies/${agencyId}/clients/${clientId}/importJobs`).add({
      source: 'drive',
      status: 'queued',
      folderId: folderId ?? null,
      fileId: fileId ?? null,
      totalCount: 0,
      processedCount: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { jobId: jobRef.id };
  } catch (error) {
    toHttpsError(error);
  }
});

export const driveImportWorker = onDocumentCreated(
  'agencies/{agencyId}/clients/{clientId}/importJobs/{jobId}',
  async (event) => {
    const { agencyId, clientId, jobId } = event.params;
    const jobRef = db.doc(`agencies/${agencyId}/clients/${clientId}/importJobs/${jobId}`);
    const jobDoc = await jobRef.get();
    const job = jobDoc.data();
    if (!job || job.status !== 'queued') {
      return;
    }
    await jobRef.update({ status: 'running', updatedAt: FieldValue.serverTimestamp() });

    const connection = await createConnectionRef(agencyId, clientId, 'drive').get();
    const tokenRefKey = connection.data()?.tokenRefKey as string | undefined;
    if (!tokenRefKey) {
      await jobRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() });
      return;
    }

    try {
      const token = await getValidAccessToken('drive', tokenRefKey);
      const files = job.folderId
        ? await driveAdapter.listFolderFiles(token, job.folderId)
        : job.fileId
        ? [await driveAdapter.getFileMetadata(token, job.fileId)]
        : [];
      await jobRef.update({ totalCount: files.length, updatedAt: FieldValue.serverTimestamp() });

      for (const file of files) {
        try {
          const response = await driveAdapter.downloadFile(token, file.id);
          const assetRef = db
            .collection(`agencies/${agencyId}/clients/${clientId}/assets`)
            .doc();
          const storagePath = `agencies/${agencyId}/clients/${clientId}/assets/${assetRef.id}/original`;
          await storage.file(storagePath).save(Buffer.from(response.data), {
            contentType: file.mimeType,
            resumable: false,
          });
          await assetRef.set({
            type: file.mimeType.startsWith('video/') ? 'video' : 'image',
            storagePath,
            originalName: file.name,
            mimeType: file.mimeType,
            size: file.size ? Number(file.size) : Buffer.byteLength(Buffer.from(response.data)),
            source: 'drive',
            driveFileId: file.id,
            driveModifiedTime: file.modifiedTime ?? null,
            createdAt: FieldValue.serverTimestamp(),
          });
          await jobRef.update({
            processedCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Drive import error';
          await jobRef.update({
            processedCount: FieldValue.increment(1),
            errors: FieldValue.arrayUnion({ fileId: file.id, message }),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      await jobRef.update({ status: 'done', updatedAt: FieldValue.serverTimestamp() });
    } catch (error) {
      await jobRef.update({
        status: 'failed',
        errors: FieldValue.arrayUnion({ message: error instanceof Error ? error.message : 'Drive import failed' }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

export const createPost = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, title, platforms } = request.data as {
      agencyId: string;
      clientId: string;
      title?: string;
      platforms: PostPlatform[];
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Editor', 'Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);

    const postRef = db.collection(`agencies/${agencyId}/clients/${clientId}/posts`).doc();
    await postRef.set({
      status: 'draft',
      title: title ? sanitizeText(title) : null,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const batch = db.batch();
    platforms.forEach((platform) => {
      const variantRef = postRef.collection('variants').doc(platform);
      batch.set(variantRef, { platform, text: '', assetRefs: [], settings: {} });
    });
    await batch.commit();

    return { postId: postRef.id };
  } catch (error) {
    toHttpsError(error);
  }
});

export const updateVariant = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, postId, platform, text, assetRefs, settings } = request.data as {
      agencyId: string;
      clientId: string;
      postId: string;
      platform: PostPlatform;
      text: string;
      assetRefs: string[];
      settings: Record<string, unknown>;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Editor', 'Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);

    const assets = await getAssetsByIds(agencyId, clientId, assetRefs);
    assets.forEach((asset) => {
      if (asset.data()?.deletedAt) {
        throw new HttpsError('failed-precondition', 'Asset deleted');
      }
    });

    await db
      .doc(`agencies/${agencyId}/clients/${clientId}/posts/${postId}/variants/${platform}`)
      .set(
        {
          platform,
          text: sanitizeText(text ?? ''),
          assetRefs,
          settings: settings ?? {},
        },
        { merge: true },
      );
    return { updated: true };
  } catch (error) {
    toHttpsError(error);
  }
});

export const submitForReview = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, postId } = request.data as {
      agencyId: string;
      clientId: string;
      postId: string;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Editor', 'Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);

    const postRef = db.doc(`agencies/${agencyId}/clients/${clientId}/posts/${postId}`);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(postRef);
      if (!doc.exists) {
        throw new HttpsError('not-found', 'Post not found');
      }
      if (doc.data()?.status !== 'draft') {
        throw new HttpsError('failed-precondition', 'Post not in draft');
      }
      tx.update(postRef, { status: 'in_review', updatedAt: FieldValue.serverTimestamp() });
    });
    return { status: 'in_review' };
  } catch (error) {
    toHttpsError(error);
  }
});

export const approvePost = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, postId, decision, reason } = request.data as {
      agencyId: string;
      clientId: string;
      postId: string;
      decision: 'approve' | 'reject';
      reason?: string;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Approver', 'Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);

    const postRef = db.doc(`agencies/${agencyId}/clients/${clientId}/posts/${postId}`);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(postRef);
      if (!doc.exists) {
        throw new HttpsError('not-found', 'Post not found');
      }
      if (doc.data()?.status !== 'in_review') {
        throw new HttpsError('failed-precondition', 'Post not in review');
      }
      if (decision === 'approve') {
        tx.update(postRef, { status: 'approved', updatedAt: FieldValue.serverTimestamp() });
      } else {
        tx.update(postRef, {
          status: 'draft',
          reviewReason: reason ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return { status: decision === 'approve' ? 'approved' : 'draft' };
  } catch (error) {
    toHttpsError(error);
  }
});

export const schedulePost = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, postId, publishAtISO, timezone } = request.data as {
      agencyId: string;
      clientId: string;
      postId: string;
      publishAtISO: string;
      timezone: string;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Editor', 'Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);

    const publishAt = new Date(publishAtISO);
    if (Number.isNaN(publishAt.getTime())) {
      throw new HttpsError('invalid-argument', 'Invalid publishAt');
    }

    const scheduleKey = crypto.createHash('sha256').update(`${postId}:${publishAtISO}`).digest('hex');
    const postRef = db.doc(`agencies/${agencyId}/clients/${clientId}/posts/${postId}`);
    const scheduleRef = postRef.collection('schedules').doc();

    await db.runTransaction(async (tx) => {
      const postDoc = await tx.get(postRef);
      if (!postDoc.exists) {
        throw new HttpsError('not-found', 'Post not found');
      }
      if (postDoc.data()?.status !== 'approved') {
        throw new HttpsError('failed-precondition', 'Post not approved');
      }
      const existing = await postRef
        .collection('schedules')
        .where('idempotencyKey', '==', scheduleKey)
        .limit(1)
        .get();
      if (!existing.empty) {
        throw new HttpsError('already-exists', 'Schedule already exists');
      }
      tx.set(scheduleRef, {
        publishAt: Timestamp.fromDate(publishAt),
        timezone,
        status: 'scheduled',
        attemptCount: 0,
        idempotencyKey: scheduleKey,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(postRef, { status: 'scheduled', updatedAt: FieldValue.serverTimestamp() });
    });

    return { scheduleId: scheduleRef.id };
  } catch (error) {
    toHttpsError(error);
  }
});

const writeLog = async (
  agencyId: string,
  clientId: string,
  postId: string,
  platform: string,
  status: 'success' | 'error',
  errorMessage?: string,
) => {
  await db.collection(`agencies/${agencyId}/clients/${clientId}/posts/${postId}/logs`).add({
    platform,
    status,
    errorMessage: errorMessage ?? null,
    retryCount: 0,
    at: FieldValue.serverTimestamp(),
  });
};

const publishWorkerInternal = async (agencyId: string, clientId: string, postId: string, scheduleId: string) => {
  const scheduleRef = db.doc(`agencies/${agencyId}/clients/${clientId}/posts/${postId}/schedules/${scheduleId}`);
  const postRef = db.doc(`agencies/${agencyId}/clients/${clientId}/posts/${postId}`);

  await db.runTransaction(async (tx) => {
    const scheduleDoc = await tx.get(scheduleRef);
    if (!scheduleDoc.exists) {
      throw new HttpsError('not-found', 'Schedule not found');
    }
    if (!['pending', 'scheduled'].includes(scheduleDoc.data()?.status)) {
      throw new HttpsError('failed-precondition', 'Schedule not ready');
    }
    tx.update(scheduleRef, {
      status: 'publishing',
      lockedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(postRef, { status: 'publishing', updatedAt: FieldValue.serverTimestamp() });
  });

  const variants = await getPlatformVariants(agencyId, clientId, postId);
  const connectionDocs = await db
    .collection(`agencies/${agencyId}/clients/${clientId}/connections`)
    .get();
  const connections = new Map(connectionDocs.docs.map((doc) => [doc.id, doc.data()]));

  let hasError = false;

  for (const variant of variants) {
    const data = variant.data();
    const platform = data.platform as PostPlatform;
    try {
      if (!connections.get(platformMap(platform))?.tokenRefKey) {
        throw new AdapterError('failed-precondition', `Missing connection for ${platform}`);
      }
      const tokenRefKey = connections.get(platformMap(platform))?.tokenRefKey as string;
      const access = await getValidAccessToken(platformMap(platform), tokenRefKey);
      const assetDocs = await getAssetsByIds(agencyId, clientId, data.assetRefs ?? []);
      const signedUrls = await Promise.all(
        assetDocs.map((doc) => generateSignedUrl(doc.data()?.storagePath as string, 900)),
      );
      const message = sanitizeText(data.text ?? '');

      if (platform === 'facebook') {
        await metaAdapter.publishFacebookPost(connections.get('meta')?.accountId as string, access, message, signedUrls);
      }
      if (platform === 'instagram') {
        const igBusinessId = connections.get('meta')?.igBusinessId as string;
        const asset = assetDocs[0];
        const mimeType = asset.data()?.mimeType as string;
        const mediaType = isVideoMime(mimeType) ? 'VIDEO' : 'IMAGE';
        await metaAdapter.publishInstagramPost(igBusinessId, access, message, signedUrls[0], mediaType);
      }
      if (platform === 'youtube') {
        const asset = assetDocs[0];
        const mimeType = asset.data()?.mimeType as string;
        assertMimeAllowed(mimeType, ['video/mp4', 'video/quicktime']);
        const settings = data.settings ?? {};
        await ytAdapter.uploadVideo(
          access,
          signedUrls[0],
          sanitizeText((settings as { title?: string }).title ?? 'AuraSocial Video'),
          sanitizeText((settings as { description?: string }).description ?? ''),
          (settings as { publishAt?: string }).publishAt,
          ((settings as { privacyStatus?: 'private' | 'public' | 'unlisted' }).privacyStatus ?? 'private') as
            | 'private'
            | 'public'
            | 'unlisted',
        );
      }
      if (platform === 'tiktok') {
        const asset = assetDocs[0];
        const mimeType = asset.data()?.mimeType as string;
        assertMimeAllowed(mimeType, ['video/mp4', 'video/quicktime']);
        await tikTokAdapter.publishVideo(access, signedUrls[0], message);
      }

      await writeLog(agencyId, clientId, postId, platform, 'success');
    } catch (error) {
      hasError = true;
      const message = error instanceof Error ? error.message : 'Publish error';
      await writeLog(agencyId, clientId, postId, platform, 'error', message);
    }
  }

  const scheduleDoc = await scheduleRef.get();
  const attemptCount = scheduleDoc.data()?.attemptCount ?? 0;
  if (hasError) {
    if (attemptCount < 3) {
      const backoffMinutes = Math.pow(2, attemptCount);
      await scheduleRef.update({
        status: 'scheduled',
        publishAt: Timestamp.fromMillis(Date.now() + backoffMinutes * 60 * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await postRef.update({ status: 'scheduled', updatedAt: FieldValue.serverTimestamp() });
    } else {
      await scheduleRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() });
      await postRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() });
    }
  } else {
    await scheduleRef.update({ status: 'published', updatedAt: FieldValue.serverTimestamp() });
    await postRef.update({ status: 'published', updatedAt: FieldValue.serverTimestamp() });
  }
};

const platformMap = (platform: PostPlatform): Platform => {
  if (platform === 'facebook' || platform === 'instagram') {
    return 'meta';
  }
  return platform;
};

export const schedulerTick = onSchedule('every 3 minutes', async () => {
  const now = Timestamp.now();
  const schedules = await db.collectionGroup('schedules').where('status', '==', 'scheduled').where('publishAt', '<=', now).get();
  for (const scheduleDoc of schedules.docs) {
    const scheduleRef = scheduleDoc.ref;
    const postRef = scheduleRef.parent.parent;
    if (!postRef) {
      continue;
    }
    const postId = postRef.id;
    const clientRef = postRef.parent.parent;
    if (!clientRef) {
      continue;
    }
    const clientId = clientRef.id;
    const agencyRef = clientRef.parent.parent;
    if (!agencyRef) {
      continue;
    }
    const agencyId = agencyRef.id;

    const locked = await db.runTransaction(async (tx) => {
      const doc = await tx.get(scheduleRef);
      if (doc.data()?.status !== 'scheduled') {
        return false;
      }
      tx.update(scheduleRef, {
        status: 'pending',
        lockedAt: FieldValue.serverTimestamp(),
        attemptCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (locked) {
      await publishWorkerInternal(agencyId, clientId, postId, scheduleDoc.id);
    }
  }
});

export const publishWorker = onCall(async (request) => {
  try {
    const uid = assertAuthed(request);
    const { agencyId, clientId, postId, scheduleId } = request.data as {
      agencyId: string;
      clientId: string;
      postId: string;
      scheduleId: string;
    };
    assertTenantIds(agencyId, clientId);
    const profile = await getUserProfile(uid);
    ensureAgencyMatch(agencyId, profile.agencyId);
    assertRole(profile.role, ['Admin', 'Owner']);
    await assertAgencyClientAccess(agencyId, clientId, uid);
    await publishWorkerInternal(agencyId, clientId, postId, scheduleId);
    return { published: true };
  } catch (error) {
    toHttpsError(error);
  }
});
