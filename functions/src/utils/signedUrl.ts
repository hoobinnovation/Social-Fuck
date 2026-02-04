import { getStorage } from 'firebase-admin/storage';

export const generateSignedUrl = async (storagePath: string, expiresInSeconds: number) => {
  const bucket = getStorage().bucket();
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
};
