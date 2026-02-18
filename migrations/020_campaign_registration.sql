-- 020: Campaign registration links + moderation comment
-- Одноразовые ссылки для регистрации площадок + поле для комментария модерации

-- Таблица ссылок регистрации
CREATE TABLE IF NOT EXISTS registration_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  used_by UUID REFERENCES users(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registration_links_token_hash ON registration_links(token_hash);

-- Комментарий модерации в campaign_info
ALTER TABLE campaign_info
  ADD COLUMN IF NOT EXISTS moderation_comment TEXT,
  ADD COLUMN IF NOT EXISTS moderation_at TIMESTAMPTZ;
