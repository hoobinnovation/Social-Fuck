import { AdapterError } from '../utils/errors';
import { fetchJson, fetchBuffer } from '../utils/http';

const TIKTOK_BASE = 'https://open.tiktokapis.com/v2';

export interface TikTokUser {
  open_id: string;
  display_name?: string;
}

export const getUserInfo = async (accessToken: string): Promise<TikTokUser> => {
  const response = await fetchJson<{ data?: { user: TikTokUser }; error?: { message: string } }>(
    `${TIKTOK_BASE}/user/info/?fields=open_id,display_name`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status >= 400 || response.data.error) {
    throw new AdapterError('failed-precondition', response.data.error?.message ?? 'TikTok user info failed');
  }
  return response.data.data?.user as TikTokUser;
};

export const publishVideo = async (accessToken: string, fileUrl: string, caption: string) => {
  const initResponse = await fetchJson<{
    data?: { upload_url: string; publish_id: string };
    error?: { message: string };
  }>(`${TIKTOK_BASE}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ caption }),
  });

  if (initResponse.status >= 400 || initResponse.data.error || !initResponse.data.data?.upload_url) {
    throw new AdapterError('failed-precondition', initResponse.data.error?.message ?? 'TikTok upload init failed');
  }

  const fileResponse = await fetchBuffer(fileUrl, { timeoutMs: 60000 });
  if (fileResponse.status >= 400) {
    throw new AdapterError('failed-precondition', 'Failed to download TikTok video');
  }

  const uploadResponse = await fetchJson<Record<string, unknown>>(initResponse.data.data.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': fileResponse.headers.get('content-type') ?? 'application/octet-stream',
    },
    body: Buffer.from(fileResponse.data),
    timeoutMs: 120000,
  });

  if (uploadResponse.status >= 400) {
    throw new AdapterError('failed-precondition', 'TikTok upload failed');
  }

  return { remoteId: initResponse.data.data.publish_id };
};
