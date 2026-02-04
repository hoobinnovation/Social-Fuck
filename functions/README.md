# AuraSocial Firebase Functions (Backend)

## Required Secrets / Environment Variables
Set these via Firebase Secrets or `firebase functions:config:set` (prefer Secrets in production):

- `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
- `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REDIRECT_URI`
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `FRONTEND_SUCCESS_URL` (optional) – used for OAuth callback redirect

> OAuth callbacks fail with `failed-precondition` if any required key is missing for the platform.

## OAuth Redirect URLs
Configure your OAuth providers with the following callback URLs (adjust the region/domain as deployed):

- Meta: `https://<region>-<project>.cloudfunctions.net/oauthCallbackMeta`
- YouTube: `https://<region>-<project>.cloudfunctions.net/oauthCallbackYouTube`
- TikTok: `https://<region>-<project>.cloudfunctions.net/oauthCallbackTikTok`
- Google Drive: `https://<region>-<project>.cloudfunctions.net/oauthCallbackDrive`

## Deploy
```bash
firebase deploy --only functions
```

## Emulators
```bash
firebase emulators:start --only functions,firestore,storage,auth
```

OAuth callbacks may require a public tunnel (e.g., ngrok) because provider redirects must reach your local emulator.

## Troubleshooting
- **redirect_uri_mismatch**: Ensure the redirect URI in the provider settings exactly matches the deployed callback URL.
- **invalid_scope**: Verify the requested scopes are enabled in the provider console.
- **permissions**: Make sure the connected account has permissions for Pages/Channels, and the app has been reviewed.

## Security Notes
- Access/refresh tokens are stored in Google Secret Manager and referenced by `tokenRefKey` in Firestore.
- Tokens are never logged or returned to clients.
