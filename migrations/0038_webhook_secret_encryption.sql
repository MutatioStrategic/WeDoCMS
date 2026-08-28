-- Retain the legacy column for SQLite compatibility. The Worker writes and
-- reads AES-GCM ciphertext, then clears plaintext values during migration.
ALTER TABLE webhook_subscriptions ADD COLUMN secret_ciphertext TEXT;
ALTER TABLE webhook_subscriptions ADD COLUMN secret_iv TEXT;
