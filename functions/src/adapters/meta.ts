import { AdapterError } from '../utils/errors';
import { fetchJson } from '../utils/http';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

export interface MetaPage {
  id: string;
  name: string;
  instagram_business_account?: { id: string };
}

export const listPages = async (accessToken: string): Promise<MetaPage[]> => {
  const url = `${GRAPH_BASE}/me/accounts?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(
    accessToken,
  )}`;
  const response = await fetchJson<{ data?: MetaPage[]; error?: { message: string } }>(url);
  if (response.status >= 400 || response.data.error) {
    throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Meta list pages failed');
  }
  return response.data.data ?? [];
};

export const getPageDetails = async (pageId: string, accessToken: string) => {
  const url = `${GRAPH_BASE}/${pageId}?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(
    accessToken,
  )}`;
  const response = await fetchJson<{ instagram_business_account?: { id: string }; error?: { message: string } }>(url);
  if (response.status >= 400 || response.data.error) {
    throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Meta page details failed');
  }
  return response.data;
};

export const publishFacebookPost = async (
  pageId: string,
  accessToken: string,
  message: string,
  mediaUrls: string[],
) => {
  if (mediaUrls.length === 0) {
    const url = `${GRAPH_BASE}/${pageId}/feed`;
    const response = await fetchJson<{ id?: string; error?: { message: string } }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: accessToken }).toString(),
    });
    if (response.status >= 400 || response.data.error) {
      throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Meta feed publish failed');
    }
    return { remoteId: response.data.id ?? '' };
  }

  const results: string[] = [];
  for (const url of mediaUrls) {
    const response = await fetchJson<{ id?: string; error?: { message: string } }>(`${GRAPH_BASE}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url, caption: message, access_token: accessToken }).toString(),
    });
    if (response.status >= 400 || response.data.error) {
      throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Meta photo publish failed');
    }
    if (response.data.id) {
      results.push(response.data.id);
    }
  }
  return { remoteId: results.join(',') };
};

export const publishInstagramPost = async (
  igBusinessId: string,
  accessToken: string,
  caption: string,
  mediaUrl: string,
  mediaType: 'IMAGE' | 'VIDEO',
) => {
  const createUrl = `${GRAPH_BASE}/${igBusinessId}/media`;
  const createResponse = await fetchJson<{ id?: string; error?: { message: string } }>(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      caption,
      access_token: accessToken,
      media_type: mediaType,
      ...(mediaType === 'IMAGE' ? { image_url: mediaUrl } : { video_url: mediaUrl }),
    }).toString(),
  });
  if (createResponse.status >= 400 || createResponse.data.error || !createResponse.data.id) {
    throw new AdapterError('failed-precondition', createResponse.data.error?.message ?? 'IG media create failed');
  }

  const publishResponse = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_BASE}/${igBusinessId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: createResponse.data.id, access_token: accessToken }).toString(),
    },
  );

  if (publishResponse.status >= 400 || publishResponse.data.error) {
    throw new AdapterError('failed-precondition', publishResponse.data.error?.message ?? 'IG publish failed');
  }

  return { remoteId: publishResponse.data.id ?? '' };
};
