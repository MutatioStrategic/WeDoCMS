-- Paid photographer subscriptions grant the same original-download entitlement
-- as an individual licence while the subscription remains active.
CREATE TABLE IF NOT EXISTS photographer_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  photographer_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled', 'expired')),
  paid_at TEXT,
  expires_at TEXT,
  provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, photographer_id, subscriber_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (photographer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subscriber_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photographer_subscriptions_entitlement
  ON photographer_subscriptions (organization_id, photographer_id, subscriber_id, status, expires_at);
