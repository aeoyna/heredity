-- D1 Schema for Project-X

DROP TABLE IF EXISTS specimens;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS user_sessions;

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'line' or 'mosaic'
    creator_session_id TEXT,
    created_at TEXT NOT NULL
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
    status TEXT DEFAULT 'active',
    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY,
    daily_swipes INTEGER DEFAULT 0,
    bot_flag INTEGER DEFAULT 0,
    last_swipe_at TEXT
);

-- Indexing for speed
CREATE INDEX IF NOT EXISTS idx_specimens_thread_gen_status ON specimens(thread_id, generation, status);

