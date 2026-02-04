import { HttpsError } from 'firebase-functions/v2/https';

export type AdapterErrorCode =
  | 'invalid-argument'
  | 'failed-precondition'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'resource-exhausted'
  | 'cancelled'
  | 'unknown'
  | 'internal'
  | 'unavailable'
  | 'deadline-exceeded';

export class AdapterError extends Error {
  public readonly code: AdapterErrorCode;
  public readonly details?: unknown;

  constructor(code: AdapterErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const toHttpsError = (error: unknown, fallbackMessage = 'Unexpected error') => {
  if (error instanceof HttpsError) {
    throw error;
  }
  if (error instanceof AdapterError) {
    throw new HttpsError(error.code, error.message, error.details);
  }
  if (error instanceof Error) {
    throw new HttpsError('internal', error.message);
  }
  throw new HttpsError('internal', fallbackMessage);
};
