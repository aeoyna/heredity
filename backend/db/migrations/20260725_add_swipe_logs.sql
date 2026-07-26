-- Migration to add swipe_logs and archived_specimens for research logging
CREATE TABLE IF NOT EXISTS swipe_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    specimen_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    vote TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archived_specimens (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    dna TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_swipe_logs_thread_gen ON swipe_logs(thread_id, generation);
CREATE INDEX IF NOT EXISTS idx_swipe_logs_session ON swipe_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_archived_specimens_thread_gen ON archived_specimens(thread_id, generation);
