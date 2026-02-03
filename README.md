# AuraSocial

Multi-tenant social media management platform built on Firebase.

## Structure
- `apps/web`: Vue 3 + Ionic Vue + Vuetify 3 + TypeScript + Pinia + Vue Router
- `functions`: Firebase Cloud Functions v2
- `firestore`: Firestore rules and indexes
- `scripts`: seed and utilities

## Prerequisites
- Node.js 18+
- Firebase CLI

## Local Setup
1. Install dependencies:
   ```bash
   cd apps/web && npm install
   cd ../functions && npm install
   ```
2. Configure Firebase:
   ```bash
   firebase use <project-id>
   ```
3. Configure required environment variables for Functions (use `.env` or Firebase env config):
   - `ENCRYPTION_MASTER_KEY` (base64-encoded 32-byte key for AES-256-GCM)
   - `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`
4. Run the web app:
   ```bash
   cd apps/web && npm run dev
   ```
5. Run functions emulator:
   ```bash
   cd functions && npm run serve
   ```

## Web App Notes
- Set `VITE_USE_EMULATORS=true` to connect the frontend to local emulators.
- Ensure Auth, Firestore, Storage, and Functions emulators are running before using the UI.

## TODO
- Provide Firebase project config (API keys, App Check site key)
