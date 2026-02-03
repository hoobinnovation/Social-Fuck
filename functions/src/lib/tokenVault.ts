import { FieldValue, Firestore } from "firebase-admin/firestore";
import { decryptJson, encryptJson } from "./crypto.js";

export interface TokenVaultEntry {
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

export interface StoredTokenPayload {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  [key: string]: unknown;
}

export function tokenVaultRef(db: Firestore, agencyId: string, connectionId: string) {
  return db
    .collection("agencies")
    .doc(agencyId)
    .collection("tokenVault")
    .doc(connectionId);
}

export async function storeToken(
  db: Firestore,
  agencyId: string,
  connectionId: string,
  payload: StoredTokenPayload,
) {
  const encrypted = encryptJson(payload);
  await tokenVaultRef(db, agencyId, connectionId).set(
    {
      ...encrypted,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function readToken(
  db: Firestore,
  agencyId: string,
  connectionId: string,
): Promise<StoredTokenPayload> {
  const snap = await tokenVaultRef(db, agencyId, connectionId).get();
  if (!snap.exists) {
    throw new Error("Token not found");
  }
  const data = snap.data() as TokenVaultEntry;
  return decryptJson<StoredTokenPayload>({
    ciphertext: data.ciphertext,
    iv: data.iv,
    tag: data.tag,
  });
}

export async function deleteToken(db: Firestore, agencyId: string, connectionId: string) {
  await tokenVaultRef(db, agencyId, connectionId).delete();
}
