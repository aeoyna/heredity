-- Denormalize threads table to avoid expensive JOIN with specimens
-- Adds total_swipes and current_generation columns directly to threads

ALTER TABLE threads ADD COLUMN total_swipes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN current_generation INTEGER NOT NULL DEFAULT 0;

-- Backfill existing data from specimens
UPDATE threads SET total_swipes = (
  SELECT COALESCE(SUM(likes_count + nopes_count), 0)
  FROM specimens WHERE thread_id = threads.id AND status = 'active'
);
UPDATE threads SET current_generation = (
  SELECT COALESCE(MAX(generation), 0)
  FROM specimens WHERE thread_id = threads.id AND status = 'active'
);
