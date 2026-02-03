export interface TikTokPublishPayload {
  accessToken: string;
  caption: string;
  videoBuffer: Buffer;
  publishAt?: string;
}

export async function publishToTikTok(payload: TikTokPublishPayload) {
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${payload.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: payload.caption.slice(0, 150),
        privacy_level: "PUBLIC",
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: payload.videoBuffer.length,
        chunk_size: payload.videoBuffer.length,
        total_chunk_count: 1,
      },
    }),
  });

  const initData = await initRes.json();
  if (!initRes.ok) {
    throw new Error(`TikTok init error ${initRes.status}: ${JSON.stringify(initData)}`);
  }

  const uploadUrl = initData?.data?.upload_url as string | undefined;
  if (!uploadUrl) {
    throw new Error("TikTok upload URL missing");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": payload.videoBuffer.length.toString(),
    },
    body: payload.videoBuffer,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`TikTok upload error ${uploadRes.status}: ${text}`);
  }

  const publishId = initData?.data?.publish_id as string | undefined;
  return { id: publishId ?? "unknown", platform: "tiktok" };
}
