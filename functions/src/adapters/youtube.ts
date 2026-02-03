export interface YouTubePublishPayload {
  accessToken: string;
  title: string;
  description: string;
  publishAt?: string;
  videoBuffer: Buffer;
  mimeType: string;
}

export async function publishToYouTube(payload: YouTubePublishPayload) {
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.accessToken}`,
        "X-Upload-Content-Type": payload.mimeType,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: {
          title: payload.title,
          description: payload.description,
        },
        status: payload.publishAt
          ? { privacyStatus: "private", publishAt: payload.publishAt }
          : { privacyStatus: "public" },
      }),
    },
  );

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`YouTube init error ${initRes.status}: ${text}`);
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube upload URL missing");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${payload.accessToken}`,
      "Content-Type": payload.mimeType,
      "Content-Length": payload.videoBuffer.length.toString(),
    },
    body: payload.videoBuffer,
  });

  const data = await uploadRes.json();
  if (!uploadRes.ok) {
    throw new Error(`YouTube upload error ${uploadRes.status}: ${JSON.stringify(data)}`);
  }

  return { id: data.id as string, platform: "youtube" };
}
