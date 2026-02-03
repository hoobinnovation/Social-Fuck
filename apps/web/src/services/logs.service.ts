import { collectionGroup, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { LogEntry } from "../types/models";

export function listenLogs(
  agencyId: string,
  clientId: string,
  onUpdate: (logs: LogEntry[]) => void,
) {
  const q = query(
    collectionGroup(db, "logs"),
    where("agencyId", "==", agencyId),
    where("clientId", "==", clientId),
    orderBy("at", "desc"),
  );
  return onSnapshot(q, (snapshot) => {
    const logs = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<LogEntry, "id">),
    }));
    onUpdate(logs);
  });
}
