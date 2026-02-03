import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import type { Asset } from "../types/models";

export function listenAssets(
  agencyId: string,
  clientId: string,
  onUpdate: (assets: Asset[]) => void,
) {
  const ref = collection(db, "agencies", agencyId, "clients", clientId, "assets");
  const q = query(ref, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const assets = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Asset, "id">),
    }));
    onUpdate(assets);
  });
}

export async function uploadAsset(
  agencyId: string,
  clientId: string,
  file: File,
) {
  const assetRef = doc(collection(db, "agencies", agencyId, "clients", clientId, "assets"));
  const storagePath = `agencies/${agencyId}/clients/${clientId}/assets/${assetRef.id}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  await setDoc(assetRef, {
    type: file.type.startsWith("video") ? "video" : "image",
    storagePath,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    source: "upload",
    downloadUrl: url,
    createdAt: serverTimestamp(),
  });
  return assetRef.id;
}

export async function softDeleteAsset(agencyId: string, clientId: string, assetId: string) {
  return updateDoc(doc(db, "agencies", agencyId, "clients", clientId, "assets", assetId), {
    deletedAt: serverTimestamp(),
  });
}

export async function hardDeleteAsset(
  agencyId: string,
  clientId: string,
  asset: Asset,
) {
  await deleteObject(ref(storage, asset.storagePath));
  return updateDoc(doc(db, "agencies", agencyId, "clients", clientId, "assets", asset.id), {
    deletedAt: serverTimestamp(),
    hardDeleted: true,
  });
}
