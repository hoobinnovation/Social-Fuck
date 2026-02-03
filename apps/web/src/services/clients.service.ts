import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { Client } from "../types/models";

export function listenClients(agencyId: string, onUpdate: (clients: Client[]) => void) {
  const ref = collection(db, "agencies", agencyId, "clients");
  const q = query(ref, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const clients = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Client, "id">),
    }));
    onUpdate(clients);
  });
}

export async function createClient(agencyId: string, payload: { name: string; timezone: string }) {
  return addDoc(collection(db, "agencies", agencyId, "clients"), {
    name: payload.name,
    timezone: payload.timezone,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateClient(agencyId: string, clientId: string, payload: Partial<Client>) {
  return updateDoc(doc(db, "agencies", agencyId, "clients", clientId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function archiveClient(agencyId: string, clientId: string) {
  return updateDoc(doc(db, "agencies", agencyId, "clients", clientId), {
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
