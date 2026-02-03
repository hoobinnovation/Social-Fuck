import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });

const db = getFirestore();

async function seed() {
  const agencyRef = db.collection("agencies").doc("demo-agency");
  await agencyRef.set({
    name: "AuraSocial Demo",
    createdAt: FieldValue.serverTimestamp(),
  });

  await agencyRef.collection("clients").doc("demo-client").set({
    name: "Demo Client",
    timezone: "Africa/Cairo",
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log("Seeded demo agency and client");
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
