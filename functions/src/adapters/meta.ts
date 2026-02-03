export interface MetaPublishPayload {
  accessToken: string;
  pageId: string;
  igUserId?: string;
  caption: string;
  mediaUrls: string[];
}

async function postJson<T>(url: string, body: Record<string, string>) {
  const params = new URLSearchParams(body);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(`Meta API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function publishToMeta(payload: MetaPublishPayload) {
  if (!payload.pageId) {
    throw new Error("Meta publish requires pageId");
  }
  if (payload.mediaUrls.length === 0) {
    const res = await postJson<{ id: string }>(
      `https://graph.facebook.com/v19.0/${payload.pageId}/feed`,
      { message: payload.caption, access_token: payload.accessToken },
    );
    return { id: res.id, platform: "facebook" };
  }

  const mediaUrl = payload.mediaUrls[0];
  const isVideo = mediaUrl.toLowerCase().includes(".mp4");
  const endpoint = isVideo ? "videos" : "photos";
  const data = await postJson<{ id: string }>(
    `https://graph.facebook.com/v19.0/${payload.pageId}/${endpoint}`,
    {
      url: mediaUrl,
      caption: payload.caption,
      access_token: payload.accessToken,
    },
  );

  if (payload.igUserId) {
    const container = await postJson<{ id: string }>(
      `https://graph.facebook.com/v19.0/${payload.igUserId}/media`,
      {
        caption: payload.caption,
        image_url: mediaUrl,
        access_token: payload.accessToken,
      },
    );
    await postJson<{ id: string }>(
      `https://graph.facebook.com/v19.0/${payload.igUserId}/media_publish`,
      {
        creation_id: container.id,
        access_token: payload.accessToken,
      },
    );
  }

  return { id: data.id, platform: "facebook" };
}
