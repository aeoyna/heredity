-- Persist one representative record per generation in a dedicated history table.

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

CREATE INDEX IF NOT EXISTS idx_thread_history_thread_generation ON thread_history(thread_id, generation DESC);

-- Backfill any archived representative rows from the old storage model.
INSERT OR REPLACE INTO thread_history (
  thread_id, generation, specimen_id, dna, likes_count, nopes_count, is_honeypot, captured_at
)
SELECT
  s1.thread_id,
  s1.generation,
  s1.id,
  s1.dna,
  s1.likes_count,
  s1.nopes_count,
  s1.is_honeypot,
  CURRENT_TIMESTAMP
FROM specimens s1
WHERE s1.status = 'archived'
  AND s1.id = (
    SELECT id
    FROM specimens s2
    WHERE s2.thread_id = s1.thread_id
      AND s2.generation = s1.generation
      AND s2.status = 'archived'
    ORDER BY s2.is_representative DESC, s2.likes_count DESC, s2.id ASC
    LIMIT 1
  );
