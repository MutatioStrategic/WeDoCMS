# Disaster recovery

The application uses two R2 buckets for media and two R2 buckets for D1 exports:

- `veld-archive-media` and `veld-archive-media-dr`
- `veld-archive-backups` and `veld-archive-backups-dr`

The DR bucket is intentionally undelete-friendly. Object-create notifications replicate new uploads quickly, and the Worker runs a full catch-up scan every 15 minutes. The scheduled scan also writes a manifest under `r2-manifests/`. D1 is backed up by the scheduled GitHub Actions workflow and the local `npm run backup:d1` command; each SQL export is uploaded to both backup buckets with a SHA-256 manifest.

R2 location hints are best-effort placement hints, not a guarantee of physical residency. This setup uses `wnam` for the primary and `weur` for the DR copy. Confirm actual placement in the R2 dashboard after provisioning.

## Provisioning

```powershell
./scripts/provision-dr.ps1
wrangler d1 migrations apply veld-archive --remote
wrangler secret put STREAM_WEBHOOK_SECRET
wrangler secret put CHAOS_TEST_TOKEN
```

Configure the Stream webhook URL as `https://<worker-host>/api/webhooks/stream`. Register the R2 event notification only once; the provisioning script uses the `originals/` prefix to avoid copying generated backup artifacts.

## Restore

Before changing a production binding, validate the downloaded export and its manifest:

```powershell
npm run test:backup -- -BackupSql .backups/veld-archive-<timestamp>.sql -Manifest .backups/veld-archive-<timestamp>.manifest.json
```

1. Select the newest D1 SQL export whose manifest hash matches the downloaded file.
2. Create a replacement D1 database and run `wrangler d1 execute <replacement> --remote --file <backup.sql>`.
3. Point the Worker’s `DB` binding at the replacement database and deploy.
4. Promote the DR R2 bucket by changing the `MEDIA_BUCKET` binding to `veld-archive-media-dr`, then deploy.
5. Run the scheduled catch-up or verify the latest `r2-manifests/` object before reopening uploads.

The design is asynchronous: the starting RPO is about 15 minutes for media and one day for D1. Tighten the D1 workflow cadence if the business requires a smaller recovery window.
