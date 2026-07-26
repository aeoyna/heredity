-- Migration to add last_login_bonus_date tracking column to user_sessions
ALTER TABLE user_sessions ADD COLUMN last_login_bonus_date TEXT;
