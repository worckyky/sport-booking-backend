-- 152-ФЗ: таблица для всех согласий пользователей (audit trail)
CREATE TABLE IF NOT EXISTS user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL, -- 'PERSONAL_DATA', 'TERMS', 'DATA_SHARING_TO_CAMPAIGN', 'MARKETING'
  accepted BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT, -- для audit log
  user_agent TEXT, -- для audit log
  metadata JSONB, -- дополнительные данные (например campaign_id для DATA_SHARING_TO_CAMPAIGN)

  -- Индекс для быстрого поиска активных согласий
  CONSTRAINT user_consent_type_check CHECK (consent_type IN ('PERSONAL_DATA', 'TERMS', 'DATA_SHARING_TO_CAMPAIGN', 'MARKETING'))
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user_id ON user_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_type ON user_consents(consent_type);
CREATE INDEX IF NOT EXISTS idx_user_consents_user_type ON user_consents(user_id, consent_type);

COMMENT ON TABLE user_consents IS 'Аудит всех согласий пользователей (152-ФЗ)';
COMMENT ON COLUMN user_consents.consent_type IS 'PERSONAL_DATA | TERMS | DATA_SHARING_TO_CAMPAIGN | MARKETING';
COMMENT ON COLUMN user_consents.accepted IS 'TRUE = согласие дано, FALSE = отозвано';
COMMENT ON COLUMN user_consents.metadata IS 'Дополнительные данные (campaign_id, booking_id и т.д.)';
