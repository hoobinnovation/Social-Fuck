import { HttpsError } from 'firebase-functions/v2/https';

export const sanitizeText = (value: string) => value.replace(/[\u0000-\u001F\u007F]/g, '').trim();

export const assertNonEmpty = (value: string, field: string) => {
  if (!value || !value.trim()) {
    throw new HttpsError('invalid-argument', `Missing ${field}`);
  }
};

export const assertMimeAllowed = (mimeType: string, allowed: string[]) => {
  if (!allowed.includes(mimeType)) {
    throw new HttpsError('invalid-argument', `Unsupported mime type: ${mimeType}`);
  }
};

export const isVideoMime = (mimeType: string) => mimeType.startsWith('video/');
export const isImageMime = (mimeType: string) => mimeType.startsWith('image/');
