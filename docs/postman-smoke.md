# Postman/Newman priority smoke

This repository keeps a safe API smoke collection at `postman/veld-archive.postman_collection.json` and a localhost environment at `postman/local.postman_environment.json`.

Start the local Worker first, then run:

```powershell
npm run test:postman
```

The checked-in environment targets `http://127.0.0.1:8787`. To use another local or explicitly authorised test URL:

```powershell
npm run test:postman -- --env-var baseUrl=http://127.0.0.1:8799
```

The collection covers health, anonymous public contracts, published search, discovery, invalid-input rejection, protected-route denial, development login, CSRF enforcement, session identity protection, lightbox sharing, saved-search persistence, cleanup, and logout revocation. It does not call payment providers, create real uploads, or exercise production webhooks.

Newman is installed as a repository dev dependency so CI and local runs use the same runner:

```powershell
npm exec -- newman --version
```
