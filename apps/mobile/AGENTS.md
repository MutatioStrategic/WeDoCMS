# Mobile Agent Guide

Follow the root `AGENTS.md` first. The mobile app is a client for the same Veld Archive marketplace, so the root rules for identity, media previews, editorial state, payments, rights language, and production evidence still apply.

## Expo Version

This app uses Expo `~57.0.14`, React Native `0.86.2`, and React `19.2.3`. Read the exact versioned Expo docs at `https://docs.expo.dev/versions/v57.0.0/` before changing Expo APIs, native modules, config plugins, or platform build settings.

## Mobile Quality Gates

- Run `npm run mobile:typecheck` for any mobile TypeScript or shared-contract change.
- Run `npm run mobile:doctor` after dependency, Expo config, native module, or SDK changes.
- Use `npm run mobile:metro` when debugging bundler/cache issues.
- Do not fork product rules into mobile-only copies. Import or adapt shared root package contracts where possible so web, Worker, and mobile behavior stay aligned.
