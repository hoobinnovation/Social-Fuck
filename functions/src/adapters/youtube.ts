import { AdapterError } from '../utils/errors';
import { fetchBuffer, fetchJson } from '../utils/http';

const YT_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeUploadResult {
  remoteId: string;
  url?: string;
}

export const uploadVideo = async (
  accessToken: string,
  fileUrl: string,
  title: string,
  description: string,
  publishAt?: string,
  privacyStatus: 'private' | 'public' | 'unlisted' = 'private',
): Promise<YouTubeUploadResult> => {
  const metadata = {
    snippet: { title, description },
    status: {
      privacyStatus,
      ...(publishAt ? { publishAt } : {}),
    },
  };

  const initResponse = await fetchJson<unknown>(
    `${YT_UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(metadata),
      timeoutMs: 15000,
    },
  );

  const location = initResponse.headers.get('location');
  if (!location) {
    throw new AdapterError('failed-precondition', 'Missing resumable upload URL');
  }

  const fileResponse = await fetchBuffer(fileUrl, { timeoutMs: 60000 });
  if (fileResponse.status >= 400) {
    throw new AdapterError('failed-precondition', 'Failed to download video for upload');
  }

  const uploadResponse = await fetchJson<{ id?: string; error?: { message: string } }>(location, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': fileResponse.headers.get('content-type') ?? 'application/octet-stream',
    },
    body: Buffer.from(fileResponse.data),
    timeoutMs: 120000,
  });

  if (uploadResponse.status >= 400 || uploadResponse.data?.error) {
    throw new AdapterError('failed-precondition', uploadResponse.data?.error?.message ?? 'YouTube upload failed');
  }

  const videoId = uploadResponse.data?.id;
  return {
    remoteId: videoId ?? '',
    url: videoId ? `https://youtu.be/${videoId}` : undefined,
  };
};

export const listChannels = async (accessToken: string) => {
  const response = await fetchJson<{ items?: Array<{ id: string; snippet: { title: string } }>; error?: { message: string } }>(
    `${YT_API_BASE}/channels?part=snippet&mine=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status >= 400 || response.data.error) {
    throw new AdapterError('failed-precondition', response.data.error?.message ?? 'YouTube channels list failed');
  }
  return response.data.items ?? [];
};
