import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { Post, Variant } from "../types/models";

export function listenPosts(
  agencyId: string,
  clientId: string,
  onUpdate: (posts: Post[]) => void,
) {
  const ref = collection(db, "agencies", agencyId, "clients", clientId, "posts");
  const q = query(ref, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const posts = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Post, "id">),
    }));
    onUpdate(posts);
  });
}

export function listenReviewQueue(
  agencyId: string,
  clientId: string,
  onUpdate: (posts: Post[]) => void,
) {
  const ref = collection(db, "agencies", agencyId, "clients", clientId, "posts");
  const q = query(ref, where("status", "==", "in_review"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const posts = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Post, "id">),
    }));
    onUpdate(posts);
  });
}

export async function createPost(
  agencyId: string,
  clientId: string,
  payload: { title: string; createdBy: string; variants: Omit<Variant, "id">[] },
) {
  const callable = httpsCallable(functions, "createPost");
  const result = await callable({
    agencyId,
    clientId,
    title: payload.title,
    variants: payload.variants,
  });
  const data = result.data as { postId?: string };
  return data.postId ?? "";
}

export async function submitForReview(agencyId: string, clientId: string, postId: string) {
  const callable = httpsCallable(functions, "submitForReview");
  await callable({ agencyId, clientId, postId });
  return updateDoc(doc(db, "agencies", agencyId, "clients", clientId, "posts", postId), {
    status: "in_review",
    updatedAt: serverTimestamp(),
  });
}

export async function approvePost(
  agencyId: string,
  clientId: string,
  postId: string,
  decision: "approved" | "rejected",
  reason: string,
) {
  const callable = httpsCallable(functions, "approvePost");
  await callable({ agencyId, clientId, postId, decision, reason });
  return updateDoc(doc(db, "agencies", agencyId, "clients", clientId, "posts", postId), {
    status: decision === "approved" ? "approved" : "failed",
    updatedAt: serverTimestamp(),
  });
}

export async function schedulePost(
  agencyId: string,
  clientId: string,
  postId: string,
  publishAt: Date,
  timezone: string,
) {
  const callable = httpsCallable(functions, "schedulePost");
  const result = await callable({ agencyId, clientId, postId, publishAt: publishAt.toISOString(), timezone });
  const data = result.data as { scheduleId?: string };
  return data.scheduleId ?? "";
}
