-- 019: Team invitations system
-- Добавляет таблицу приглашений и поле invited_by в users

-- 1) Таблица приглашений
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role user_role NOT NULL,
  campaign_id UUID REFERENCES campaign_info(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- CAMPAIGN инвайт требует campaign_id, ADMIN инвайт — нет
  CONSTRAINT check_campaign_role CHECK (
    (role = 'CAMPAIGN' AND campaign_id IS NOT NULL) OR
    (role = 'ADMIN' AND campaign_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_campaign ON invitations(campaign_id);

-- 2) Кто пригласил пользователя (NULL = оригинальный, может приглашать)
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;
