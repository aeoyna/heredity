-- Add stamina_speed_level to user_sessions
ALTER TABLE user_sessions ADD COLUMN stamina_speed_level INTEGER DEFAULT 0;
