-- D1 Schema for Project-X

DROP TABLE IF EXISTS specimens;
DROP TABLE IF EXISTS thread_history;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS soul_grants;

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'line' or 'mosaic'
    creator_session_id TEXT,
    created_at TEXT NOT NULL,
    line_count INTEGER NOT NULL DEFAULT 10,
    total_swipes INTEGER NOT NULL DEFAULT 0,
    current_generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS specimens (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    dna TEXT NOT NULL,
    likes_count INTEGER DEFAULT 0,
    nopes_count INTEGER DEFAULT 0,
    is_honeypot INTEGER DEFAULT 0,
    is_representative INTEGER DEFAULT 0,
    assigned_session_id TEXT,
    assigned_at TEXT,
    status TEXT DEFAULT 'active',
    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS thread_history (
    thread_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    specimen_id TEXT NOT NULL,
    dna TEXT NOT NULL,
    likes_count INTEGER NOT NULL DEFAULT 0,
    nopes_count INTEGER NOT NULL DEFAULT 0,
    is_honeypot INTEGER NOT NULL DEFAULT 0,
    captured_at TEXT NOT NULL,
    PRIMARY KEY(thread_id, generation),
    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY,
    clerk_user_id TEXT,
    daily_swipes INTEGER DEFAULT 0,
    bot_flag INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    last_swipe_at TEXT,
    stamina INTEGER DEFAULT 80,
    max_stamina INTEGER DEFAULT 80,
    lifetime_swipes INTEGER DEFAULT 0,
    last_recovery_time INTEGER DEFAULT 0,
    souls INTEGER DEFAULT 0,
    is_ad_free INTEGER DEFAULT 0,
    outs INTEGER DEFAULT 0,
    last_out_recovery_time INTEGER DEFAULT 0,
    swipes_since_last_out_recovery INTEGER DEFAULT 0,
    souls_version INTEGER DEFAULT 0
);

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

-- Indexing for speed
CREATE INDEX IF NOT EXISTS idx_specimens_thread_gen_status ON specimens(thread_id, generation, status);
CREATE INDEX IF NOT EXISTS idx_specimens_thread_gen_assignment ON specimens(thread_id, generation, assigned_session_id, status);
CREATE INDEX IF NOT EXISTS idx_thread_history_thread_generation ON thread_history(thread_id, generation DESC);
CREATE INDEX IF NOT EXISTS idx_soul_grants_session_status_expiry ON soul_grants(session_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_soul_grants_stripe_session ON soul_grants(stripe_checkout_session_id);

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
);
