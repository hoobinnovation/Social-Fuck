import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';

export interface UserProfile {
  agencyId: string;
  role: string;
}

export const assertAuthed = (context: CallableRequest<unknown>) => {
  if (!context.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  return context.auth.uid;
};

export const getUserProfile = async (uid: string): Promise<UserProfile> => {
  const doc = await getFirestore().doc(`users/${uid}`).get();
  if (!doc.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const data = doc.data();
  if (!data?.agencyId || !data?.role) {
    throw new HttpsError('permission-denied', 'User profile incomplete');
  }
  return { agencyId: data.agencyId as string, role: data.role as string };
};

export const assertRole = (role: string, allowedRoles: string[]) => {
  if (!allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'Insufficient role');
  }
};

export const assertAgencyClientAccess = async (agencyId: string, clientId: string, uid?: string) => {
  const db = getFirestore();
  const [clientDoc, membershipDoc] = await Promise.all([
    db.doc(`agencies/${agencyId}/clients/${clientId}`).get(),
    uid ? db.doc(`agencies/${agencyId}/members/${uid}`).get() : Promise.resolve(null),
  ]);
  if (!clientDoc.exists) {
    throw new HttpsError('not-found', 'Client not found');
  }
  if (uid && membershipDoc && !membershipDoc.exists) {
    throw new HttpsError('permission-denied', 'User is not a member of agency');
  }
};

export const ensureAgencyMatch = (expected: string, actual: string) => {
  if (expected !== actual) {
    throw new HttpsError('permission-denied', 'Agency mismatch');
  }
};

export const assertDocExists = async (path: string) => {
  const doc = await getFirestore().doc(path).get();
  if (!doc.exists) {
    throw new HttpsError('not-found', 'Document not found');
  }
  return doc;
};

export const getAssetsByIds = async (agencyId: string, clientId: string, assetIds: string[]) => {
  if (assetIds.length === 0) {
    return [] as FirebaseFirestore.DocumentSnapshot[];
  }
  const refs = assetIds.map((id) => getFirestore().doc(`agencies/${agencyId}/clients/${clientId}/assets/${id}`));
  const docs = await getFirestore().getAll(...refs);
  const missing = docs.find((doc) => !doc.exists);
  if (missing) {
    throw new HttpsError('not-found', 'Asset not found');
  }
  return docs;
};

export const getPlatformVariants = async (agencyId: string, clientId: string, postId: string) => {
  const snap = await getFirestore()
    .collection(`agencies/${agencyId}/clients/${clientId}/posts/${postId}/variants`)
    .get();
  return snap.docs;
};

export const getSchedulesForPlatform = async (
  agencyId: string,
  clientId: string,
  postId: string,
  platform: string,
) => {
  const snap = await getFirestore()
    .collection(`agencies/${agencyId}/clients/${clientId}/posts/${postId}/schedules`)
    .where('status', 'in', ['scheduled', 'pending', 'publishing'])
    .get();
  return snap.docs.filter((doc) => doc.data().platform === platform);
};

export const assertFirestoreQueryLimit = async (path: string, field: FieldPath, values: string[]) => {
  if (values.length > 10) {
    throw new HttpsError('invalid-argument', 'Too many values');
  }
  const snap = await getFirestore().collection(path).where(field, 'in', values).get();
  return snap.docs;
};
