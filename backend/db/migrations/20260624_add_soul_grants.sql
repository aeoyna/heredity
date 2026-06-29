ALTER TABLE user_sessions ADD COLUMN souls_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS soul_grants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    stripe_checkout_session_id TEXT NOT NULL UNIQUE,
    purchase_item TEXT NOT NULL,
    amount INTEGER NOT NULL,
    remaining_amount INTEGER NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_soul_grants_session_status_expiry ON soul_grants(session_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_soul_grants_stripe_session ON soul_grants(stripe_checkout_session_id);
