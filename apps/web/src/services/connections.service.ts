import { collection, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { Connection } from "../types/models";

export function listenConnections(
  agencyId: string,
  clientId: string,
  onUpdate: (connections: Connection[]) => void,
) {
  const ref = collection(db, "agencies", agencyId, "clients", clientId, "connections");
  return onSnapshot(ref, (snapshot) => {
    const connections = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Connection, "id">),
    }));
    onUpdate(connections);
  });
}

export async function startOAuth(agencyId: string, clientId: string, platform: Connection["platform"]) {
  const callable = httpsCallable(functions, "oauthStart");
  const result = await callable({ platform, agencyId, clientId });
  const data = result.data as { authUrl?: string };
  if (!data.authUrl) {
    throw new Error("Missing authUrl from oauthStart");
  }
  return data.authUrl;
}

export async function disconnectPlatform(agencyId: string, clientId: string, platform: Connection["platform"]) {
  const callable = httpsCallable(functions, "disconnectPlatform");
  await callable({ agencyId, clientId, platform });
}
