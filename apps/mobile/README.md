# Stockvel Mobile

This is the native Expo client for Stockvel. It uses the existing Cloudflare Worker API directly and does not wrap the web application in a browser view.

## Run Metro

From the repository root:

```powershell
npm run mobile:metro
```

Set `EXPO_PUBLIC_API_BASE_URL` when pointing the app at a local or alternate Worker deployment.

Contributor submissions use Supabase email/password authentication or phone OTP authentication and exchange the verified identity token for a short-lived Stockvel API session. Copy `.env.example` to `.env`, set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `EXPO_PUBLIC_TURNSTILE_SITE_KEY`, and keep the production API URL for release builds. The publishable key is intended for client applications; never use a Supabase service-role key in the app. Phone OTP accepts South African mobile numbers in local form, such as `073 712 3456`, and converts them to E.164 before calling Supabase. Hosted Supabase still requires Phone authentication and an SMS provider to be enabled in Auth Providers.

Add `stockvel://auth/confirmed` and `stockvel://auth/recovery` to the Supabase authentication redirect allow list. Seller registration keeps the seller intent only until the first successful Stockvel session exchange; the Worker assigns the contributor role only while provisioning a new unprivileged account. Existing memberships and privileged roles are never upgraded by a client request.

## Native feature coverage

The app provides native exploration and advanced search, a buyer workspace with evidence-first licence checkout and delivery, seller registration and onboarding, authenticated uploads and metadata management, public creators, community discussions and rights-case intake, saved searches, lightboxes and sharing, contributor/buyer insights, campaign manifests, account lifecycle and subscriptions, marketplace controls, WordPress pairing, and editor/admin governance corrections. Buyer navigation keeps search, validation, terms, hosted payment, pending retry, and webhook-confirmed delivery in one native flow; seller navigation exposes Upload as the primary action. The browser workspace remains the delivery surface for canvas-based image derivatives, campaign ZIP bundles, detailed stakeholder diagram editing, and Zoho administration. Mobile reads the same persisted derivative, bundle, licence, rights, and expiry statuses and hands privileged editing or approval actions to the authenticated desktop surface. See `docs/mobile-feature-parity.md` for the maintained route-level comparison.

## Android Studio

Install Android Studio, create an Android emulator, start it, then run:

```powershell
npm run mobile:android
```

## Apple devices

The iOS Simulator and local Xcode builds require macOS. On Windows, run Metro and scan the QR code with Expo Go on an iPhone or iPad. Production iOS binaries can be created with an EAS cloud build once Apple signing credentials are configured.
