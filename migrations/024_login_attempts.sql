-- Таблица для отслеживания попыток входа
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ
);

-- Индекс для быстрого поиска по email
CREATE INDEX idx_login_attempts_email ON login_attempts(email, attempted_at DESC);

-- Индекс для очистки старых записей
CREATE INDEX idx_login_attempts_attempted_at ON login_attempts(attempted_at);

COMMENT ON TABLE login_attempts IS 'История попыток входа для защиты от brute-force атак';
COMMENT ON COLUMN login_attempts.blocked_until IS 'До какого времени аккаунт заблокирован (NULL = не заблокирован)';
