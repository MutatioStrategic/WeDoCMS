# Veld Archive Mobile

This is the native Expo client for Veld Archive. It uses the existing Cloudflare Worker API directly and does not wrap the web application in a browser view.

## Run Metro

From the repository root:

```powershell
npm run mobile:metro
```

Set `EXPO_PUBLIC_API_BASE_URL` when pointing the app at a local or alternate Worker deployment.

Contributor submissions use Supabase email/password authentication and exchange the verified identity token for a short-lived Veld API session. Copy `.env.example` to `.env`, set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and keep the production API URL for release builds. The publishable key is intended for client applications; never use a Supabase service-role key in the app.

## Android Studio

Install Android Studio, create an Android emulator, start it, then run:

```powershell
npm run mobile:android
```

## Apple devices

The iOS Simulator and local Xcode builds require macOS. On Windows, run Metro and scan the QR code with Expo Go on an iPhone or iPad. Production iOS binaries can be created with an EAS cloud build once Apple signing credentials are configured.
