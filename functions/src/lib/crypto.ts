import crypto from "node:crypto";
import { requireEnv } from "./config.js";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const key = requireEnv("ENCRYPTION_MASTER_KEY");
  const raw = Buffer.from(key, "base64");
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must be 32 bytes base64-encoded");
  }
  return raw;
}

export function encryptJson(payload: unknown) {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptJson<T>(payload: { ciphertext: string; iv: string; tag: string }): T {
  const key = getKey();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
