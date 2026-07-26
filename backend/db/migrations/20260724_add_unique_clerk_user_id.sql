-- Add partial unique index on clerk_user_id to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_clerk_user_id ON user_sessions(clerk_user_id) WHERE clerk_user_id IS NOT NULL;
