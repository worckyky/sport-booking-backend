-- 022: Add last_login_at to users table
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
