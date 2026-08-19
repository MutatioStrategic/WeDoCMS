# Veld Archive Mobile

This is the native Expo client for Veld Archive. It uses the existing Cloudflare Worker API directly and does not wrap the web application in a browser view.

## Run Metro

From the repository root:

```powershell
npm run mobile:metro
```

Set `EXPO_PUBLIC_API_BASE_URL` when pointing the app at a local or alternate Worker deployment.

## Android Studio

Install Android Studio, create an Android emulator, start it, then run:

```powershell
npm run mobile:android
```

## Apple devices

The iOS Simulator and local Xcode builds require macOS. On Windows, run Metro and scan the QR code with Expo Go on an iPhone or iPad. Production iOS binaries can be created with an EAS cloud build once Apple signing credentials are configured.
