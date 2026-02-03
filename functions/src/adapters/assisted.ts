export interface AssistedPublishPayload {
  platform: "tiktok" | "other";
  mediaUrl: string;
  caption: string;
}

export async function createAssistedPublish(payload: AssistedPublishPayload) {
  return {
    status: "assist_required",
    payload,
  };
}
