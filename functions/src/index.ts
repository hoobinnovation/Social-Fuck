import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import crypto from "node:crypto";
import { publishToMeta } from "./adapters/meta.js";
import { publishToTikTok } from "./adapters/tiktok.js";
import { publishToYouTube } from "./adapters/youtube.js";
import { requireEnv } from "./lib/config.js";
import { deleteToken, readToken, storeToken } from "./lib/tokenVault.js";

initializeApp();

const db = getFirestore();
const storage = getStorage();

const PLATFORM_SCOPES: Record<string, string[]> = {
  meta: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload"],
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  tiktok: ["user.info.basic", "video.publish"],
};

function randomState() {
  return crypto.randomBytes(16).toString("hex");
}

function connectionRef(agencyId: string, clientId: string, platform: string) {
  return db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("connections")
    .doc(platform);
}

async function requireRole(agencyId: string, uid: string, roles: string[]) {
  const memberSnap = await db
    .collection("agencies")
    .doc(agencyId)
    .collection("members")
    .doc(uid)
    .get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "Not a member of this agency");
  }
  const role = memberSnap.data()?.role as string;
  if (!roles.includes(role)) {
    throw new HttpsError("permission-denied", "Insufficient role");
  }
  return role;
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(`Request failed ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function buildAuthUrl(platform: string, state: string) {
  const scopes = PLATFORM_SCOPES[platform];
  if (!scopes) {
    throw new Error("Unsupported platform");
  }

  if (platform === "meta") {
    const appId = requireEnv("META_APP_ID");
    const redirectUri = requireEnv("META_REDIRECT_URI");
    return (
      "https://www.facebook.com/v19.0/dialog/oauth" +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(scopes.join(","))}`
    );
  }

  if (platform === "youtube" || platform === "drive") {
    const clientId = requireEnv("GOOGLE_CLIENT_ID");
    const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");
    return (
      "https://accounts.google.com/o/oauth2/v2/auth" +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(scopes.join(" "))}`
    );
  }

  if (platform === "tiktok") {
    const clientKey = requireEnv("TIKTOK_CLIENT_KEY");
    const redirectUri = requireEnv("TIKTOK_REDIRECT_URI");
    return (
      "https://www.tiktok.com/v2/auth/authorize/" +
      `?client_key=${encodeURIComponent(clientKey)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes.join(","))}` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  throw new Error("Unsupported platform");
}

export const oauthStart = onCall(async (request) => {
  const { platform, agencyId, clientId } = request.data ?? {};
  if (!platform || !agencyId || !clientId) {
    throw new HttpsError("invalid-argument", "Missing platform/agencyId/clientId");
  }
  const state = randomState();
  await db.collection("oauthStates").doc(state).set({
    platform,
    agencyId,
    clientId,
    createdAt: FieldValue.serverTimestamp(),
  });
  const authUrl = buildAuthUrl(platform, state);
  return { authUrl, state };
});

export const oauthStartHttp = onRequest(async (req, res) => {
  const platform = req.query.platform as string;
  const agencyId = req.query.agencyId as string;
  const clientId = req.query.clientId as string;
  if (!platform || !agencyId || !clientId) {
    res.status(400).json({ error: "Missing platform, agencyId, or clientId" });
    return;
  }

  const state = randomState();
  await db.collection("oauthStates").doc(state).set({
    platform,
    agencyId,
    clientId,
    createdAt: FieldValue.serverTimestamp(),
  });

  try {
    const authUrl = buildAuthUrl(platform, state);
    res.json({ authUrl, state });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

export const oauthCallback = onRequest(async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) {
    res.status(400).json({ error: "Missing code/state" });
    return;
  }

  const stateSnap = await db.collection("oauthStates").doc(state).get();
  if (!stateSnap.exists) {
    res.status(400).json({ error: "Invalid state" });
    return;
  }

  const { platform, agencyId, clientId } = stateSnap.data() as {
    platform: string;
    agencyId: string;
    clientId: string;
  };

  let tokenPayload: Record<string, unknown> = {};
  let displayName = "";
  let accountId = "";
  let igUserId = "";

  if (platform === "meta") {
    const appId = requireEnv("META_APP_ID");
    const appSecret = requireEnv("META_APP_SECRET");
    const redirectUri = requireEnv("META_REDIRECT_URI");
    const tokenRes = await fetchJson<{ access_token: string }>(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
      { method: "GET" },
    );
    tokenPayload = tokenRes;
    const profile = await fetchJson<{ id: string; name: string }>(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(
        tokenRes.access_token,
      )}`,
      { method: "GET" },
    );
    const pages = await fetchJson<{ data: { id: string; name: string }[] }>(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${encodeURIComponent(
        tokenRes.access_token,
      )}`,
      { method: "GET" },
    );
    if (pages.data?.[0]?.id) {
      const igRes = await fetchJson<{ instagram_business_account?: { id: string } }>(
        `https://graph.facebook.com/v19.0/${pages.data[0].id}?fields=instagram_business_account&access_token=${encodeURIComponent(
          tokenRes.access_token,
        )}`,
        { method: "GET" },
      );
      igUserId = igRes.instagram_business_account?.id ?? "";
    }
    displayName = pages.data?.[0]?.name ?? profile.name;
    accountId = pages.data?.[0]?.id ?? profile.id;
    tokenPayload = { ...tokenRes, igUserId };
  } else if (platform === "youtube" || platform === "drive") {
    const clientId = requireEnv("GOOGLE_CLIENT_ID");
    const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
    const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");
    tokenPayload = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const accessToken = tokenPayload.access_token as string;
    if (platform === "youtube") {
      const channel = await fetchJson<{ items: { id: string; snippet: { title: string } }[] }>(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      displayName = channel.items?.[0]?.snippet?.title ?? "YouTube Channel";
      accountId = channel.items?.[0]?.id ?? "";
    } else {
      const about = await fetchJson<{ user: { displayName: string; emailAddress?: string } }>(
        "https://www.googleapis.com/drive/v3/about?fields=user",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      displayName = about.user.displayName;
      accountId = about.user.emailAddress ?? "";
    }
  } else if (platform === "tiktok") {
    const clientKey = requireEnv("TIKTOK_CLIENT_KEY");
    const clientSecret = requireEnv("TIKTOK_CLIENT_SECRET");
    const redirectUri = requireEnv("TIKTOK_REDIRECT_URI");
    tokenPayload = await fetchJson("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    });
    const accessToken = tokenPayload.access_token as string;
    const profile = await fetchJson<{ data: { user: { display_name: string; open_id: string } } }>(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    displayName = profile.data.user.display_name;
    accountId = profile.data.user.open_id;
  }

  const connectionId = platform;
  await storeToken(db, agencyId, connectionId, tokenPayload);
  await connectionRef(agencyId, clientId, connectionId).set(
    {
      platform,
      status: "connected",
      displayName,
      accountId,
      igUserId,
      scopes: PLATFORM_SCOPES[platform] ?? [],
      tokenRefKey: connectionId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection("oauthStates").doc(state).delete();
  res.json({ status: "connected", platform });
});

export const disconnectPlatform = onCall(async (request) => {
  const { agencyId, clientId, platform } = request.data ?? {};
  if (!agencyId || !clientId || !platform) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId/platform");
  }
  const connectionId = platform;
  try {
    const token = await readToken(db, agencyId, connectionId);
    if (platform === "youtube" || platform === "drive") {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: token.access_token }).toString(),
      });
    } else if (platform === "meta") {
      await fetch(
        `https://graph.facebook.com/v19.0/me/permissions?access_token=${encodeURIComponent(
          token.access_token,
        )}`,
        { method: "DELETE" },
      );
    } else if (platform === "tiktok") {
      await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: token.access_token,
          client_key: requireEnv("TIKTOK_CLIENT_KEY"),
          client_secret: requireEnv("TIKTOK_CLIENT_SECRET"),
        }).toString(),
      });
    }
  } finally {
    await deleteToken(db, agencyId, connectionId);
  }

  await connectionRef(agencyId, clientId, connectionId).set(
    {
      status: "disconnected",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { status: "disconnected", platform };
});

export const driveImportStart = onCall(async (request) => {
  const { agencyId, clientId, folderId } = request.data ?? {};
  if (!agencyId || !clientId || !folderId) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId/folderId");
  }

  const jobRef = await db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("importJobs")
    .add({
      source: "drive",
      status: "queued",
      totalCount: 0,
      processedCount: 0,
      errors: [],
      folderId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  return { jobId: jobRef.id };
});

export const driveImportWorker = onRequest(async (req, res) => {
  const { agencyId, clientId, jobId } = req.body ?? req.query;
  if (!agencyId || !clientId || !jobId) {
    res.status(400).json({ error: "Missing agencyId/clientId/jobId" });
    return;
  }

  const jobRef = db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("importJobs")
    .doc(jobId);

  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const job = jobSnap.data() as { folderId: string };
  const token = await readToken(db, agencyId, "drive");
  const bucket = storage.bucket();
  let pageToken: string | undefined;
  let processed = 0;
  let total = 0;
  const errors: string[] = [];

  do {
    const listRes = await fetchJson<{
      files: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[];
      nextPageToken?: string;
    }>(
      `https://www.googleapis.com/drive/v3/files?q='${job.folderId}' in parents&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      { method: "GET", headers: { Authorization: `Bearer ${token.access_token}` } },
    );

    pageToken = listRes.nextPageToken;
    total += listRes.files.length;
    for (const file of listRes.files) {
      if (!file.mimeType.startsWith("image/") && !file.mimeType.startsWith("video/")) {
        continue;
      }
      try {
        const downloadRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token.access_token}` },
          },
        );
        if (!downloadRes.ok) {
          throw new Error(`Drive download failed ${downloadRes.status}`);
        }
        const buffer = Buffer.from(await downloadRes.arrayBuffer());
        const storagePath = `agencies/${agencyId}/clients/${clientId}/assets/${file.id}`;
        await bucket.file(storagePath).save(buffer, { contentType: file.mimeType });
        await db
          .collection("agencies")
          .doc(agencyId)
          .collection("clients")
          .doc(clientId)
          .collection("assets")
          .doc(file.id)
          .set({
            type: file.mimeType.startsWith("image/") ? "image" : "video",
            storagePath,
            originalName: file.name,
            mimeType: file.mimeType,
            size: Number(file.size ?? 0),
            source: "drive",
            driveFileId: file.id,
            driveModifiedTime: file.modifiedTime,
            createdAt: FieldValue.serverTimestamp(),
          });
        processed += 1;
      } catch (error) {
        errors.push(String(error));
      }
    }
  } while (pageToken);

  await jobRef.set(
    {
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      totalCount: total,
      processedCount: processed,
      errors,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  res.json({ status: "done", processed, total, errors });
});

export const createPost = onCall(async (request) => {
  const { agencyId, clientId, title, variants } = request.data ?? {};
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Missing auth");
  }
  if (!agencyId || !clientId || !title) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId/title");
  }
  await requireRole(agencyId, request.auth.uid, ["editor", "admin", "owner"]);
  const postRef = await db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("posts")
    .add({
      title,
      status: "draft",
      createdBy: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  if (Array.isArray(variants)) {
    await Promise.all(
      variants.map((variant: Record<string, unknown>) =>
        postRef.collection("variants").add(variant),
      ),
    );
  }
  return { postId: postRef.id };
});

export const submitForReview = onCall(async (request) => {
  const { agencyId, clientId, postId } = request.data ?? {};
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Missing auth");
  }
  if (!agencyId || !clientId || !postId) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId/postId");
  }
  await requireRole(agencyId, request.auth.uid, ["editor", "admin", "owner"]);
  const postRef = db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("posts")
    .doc(postId);
  await postRef.update({ status: "in_review", updatedAt: FieldValue.serverTimestamp() });
  return { status: "in_review" };
});

export const approvePost = onCall(async (request) => {
  const { agencyId, clientId, postId, decision, reason } = request.data ?? {};
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Missing auth");
  }
  if (!agencyId || !clientId || !postId || !decision) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId/postId/decision");
  }
  await requireRole(agencyId, request.auth.uid, ["approver", "admin", "owner"]);
  const postRef = db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("posts")
    .doc(postId);
  await postRef.update({
    status: decision === "approved" ? "approved" : "failed",
    updatedAt: FieldValue.serverTimestamp(),
    approvalReason: reason ?? "",
  });
  return { status: decision };
});

export const schedulePost = onCall(async (request) => {
  const { agencyId, clientId, postId, publishAt, timezone } = request.data ?? {};
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Missing auth");
  }
  if (!agencyId || !clientId || !postId || !publishAt) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId/postId/publishAt");
  }
  await requireRole(agencyId, request.auth.uid, ["editor", "admin", "owner"]);
  const scheduleRef = await db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("posts")
    .doc(postId)
    .collection("schedules")
    .add({
      publishAt: Timestamp.fromDate(new Date(publishAt)),
      timezone: timezone ?? "Africa/Cairo",
      status: "scheduled",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  await db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .collection("posts")
    .doc(postId)
    .update({
      status: "scheduled",
      updatedAt: FieldValue.serverTimestamp(),
    });
  return { scheduleId: scheduleRef.id };
});

export const schedulerTick = onSchedule("every 1 minutes", async () => {
  const now = Timestamp.fromDate(new Date());
  const dueSchedules = await db
    .collectionGroup("schedules")
    .where("status", "==", "scheduled")
    .where("publishAt", "<=", now)
    .limit(10)
    .get();

  await Promise.all(
    dueSchedules.docs.map(async (doc) => {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return;
        if (fresh.data()?.status !== "scheduled") return;
        tx.update(doc.ref, { status: "pending", updatedAt: FieldValue.serverTimestamp() });
      });
      await publishWorkerImpl(doc.ref.path);
    }),
  );
});

async function publishWorkerImpl(schedulePath: string) {
  const scheduleRef = db.doc(schedulePath);
  const scheduleSnap = await scheduleRef.get();
  if (!scheduleSnap.exists) {
    throw new Error("Schedule not found");
  }
  const scheduleData = scheduleSnap.data() as {
    publishAt: Timestamp;
    status: string;
    attemptCount?: number;
  };

  const postRef = scheduleRef.parent.parent;
  if (!postRef) {
    throw new Error("Schedule missing post reference");
  }
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new Error("Post not found");
  }
  const postData = postSnap.data() as { title?: string; status: string };
  const variantsSnap = await postRef.collection("variants").get();

  const agencyId = postRef.path.split("/")[1];
  const clientId = postRef.path.split("/")[3];

  const bucket = storage.bucket();
  for (const variant of variantsSnap.docs) {
    const variantData = variant.data() as {
      platform: string;
      text: string;
      assetRefs: string[];
    };
    const platform = variantData.platform;
    const connection = await connectionRef(agencyId, clientId, platform).get();
    if (!connection.exists) {
      throw new Error(`Missing connection for ${platform}`);
    }
    const connectionData = connection.data() as { accountId?: string; igUserId?: string };
    const token = await readToken(db, agencyId, platform);

    const assets = await Promise.all(
      (variantData.assetRefs ?? []).map(async (assetId) => {
        const assetSnap = await db
          .collection("agencies")
          .doc(agencyId)
          .collection("clients")
          .doc(clientId)
          .collection("assets")
          .doc(assetId)
          .get();
        return assetSnap.data() as { storagePath: string; mimeType: string };
      }),
    );

    if (platform === "meta") {
      const mediaUrls = await Promise.all(
        assets.map(async (asset) => {
          const [url] = await bucket.file(asset.storagePath).getSignedUrl({
            action: "read",
            expires: Date.now() + 15 * 60 * 1000,
          });
          return url;
        }),
      );
      await publishToMeta({
        accessToken: token.access_token,
        pageId: connectionData.accountId ?? "",
        igUserId: connectionData.igUserId ?? undefined,
        caption: variantData.text,
        mediaUrls,
      });
    } else if (platform === "youtube") {
      const asset = assets[0];
      if (!asset) {
        throw new Error("YouTube publish requires a video asset");
      }
      const [buffer] = await bucket.file(asset.storagePath).download();
      await publishToYouTube({
        accessToken: token.access_token,
        title: postData.title ?? "AuraSocial Post",
        description: variantData.text,
        publishAt: scheduleData.publishAt.toDate().toISOString(),
        videoBuffer: buffer,
        mimeType: asset.mimeType,
      });
    } else if (platform === "tiktok") {
      const asset = assets[0];
      if (!asset) {
        throw new Error("TikTok publish requires a video asset");
      }
      const [buffer] = await bucket.file(asset.storagePath).download();
      await publishToTikTok({
        accessToken: token.access_token,
        caption: variantData.text,
        videoBuffer: buffer,
        publishAt: scheduleData.publishAt.toDate().toISOString(),
      });
    }

    await postRef.collection("logs").add({
      platform,
      status: "published",
      agencyId,
      clientId,
      retryCount: scheduleData.attemptCount ?? 0,
      at: FieldValue.serverTimestamp(),
    });
  }

  await scheduleRef.update({
    status: "published",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await postRef.update({
    status: "published",
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export const publishWorker = onRequest(async (req, res) => {
  const schedulePath = req.body?.schedulePath ?? req.query.schedulePath;
  if (!schedulePath) {
    res.status(400).json({ error: "Missing schedulePath" });
    return;
  }
  try {
    await publishWorkerImpl(schedulePath);
    res.json({ status: "ok" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export const hardDeleteClient = onCall(async (request) => {
  const { agencyId, clientId } = request.data ?? {};
  if (!agencyId || !clientId) {
    throw new HttpsError("invalid-argument", "Missing agencyId/clientId");
  }
  await db
    .collection("agencies")
    .doc(agencyId)
    .collection("clients")
    .doc(clientId)
    .delete();
  return { status: "deleted", clientId };
});
