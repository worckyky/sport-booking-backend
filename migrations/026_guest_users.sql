-- Migration 026: Гостевые user-аккаунты
-- CLT-02: Auto-merge при верификации телефона (подготовка)
--
-- Изменения:
-- 1. users.email и users.password_hash становятся nullable (для гостей)
-- 2. Partial UNIQUE index на email (только NOT NULL значения)
-- 3. UNIQUE index на phone (защита от дубликатов)
-- 4. CHECK constraint для data integrity (guest vs registered)
-- 5. Миграция существующих гостевых броней в users
--
-- Rollback: см. комментарии в конце файла

-- ============================================================================
-- Шаг 1: Изменение constraints на users
-- ============================================================================

-- 1.1 Делаем email nullable (для гостевых аккаунтов)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 1.2 Делаем password_hash nullable (для гостевых аккаунтов)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 1.3 Удаляем старый UNIQUE constraint на email (если есть)
-- Заменяем на partial unique (только NOT NULL)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

-- 1.4 Partial UNIQUE на email (NULL разрешены, дубликаты NOT NULL запрещены)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email) WHERE email IS NOT NULL;

-- 1.5 UNIQUE constraint на phone (защита от дубликатов гостей)
-- Не используем partial index чтобы поддерживать ON CONFLICT
-- NULL values автоматически не учитываются в UNIQUE constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
  END IF;
END $$;

-- 1.6 CHECK constraint для data integrity (идемпотентно)
-- Гостевой аккаунт: phone NOT NULL, email/password NULL
-- Зарегистрированный: email/password NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_guest_or_registered'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT check_guest_or_registered
      CHECK (
        (email IS NOT NULL AND password_hash IS NOT NULL) OR  -- registered user
        (phone IS NOT NULL AND email IS NULL AND password_hash IS NULL)  -- guest user
      );

    COMMENT ON CONSTRAINT check_guest_or_registered ON users IS
      'Гостевые пользователи: phone NOT NULL, email/password NULL. Зарегистрированные: email+password NOT NULL';
  END IF;
END $$;

-- ============================================================================
-- Шаг 2: Миграция существующих гостевых броней
-- ============================================================================

-- 2.1 Создаём users для существующих гостей
-- ON CONFLICT DO NOTHING — идемпотентность (защита от повторного запуска)
INSERT INTO users (id, email, password_hash, role, name, phone, created_at, updated_at)
SELECT
  gen_random_uuid() as id,
  NULL as email,
  NULL as password_hash,
  'USER' as role,
  NULL as name,  -- name будет взят из bookings.contact_name при отображении
  contact_phone as phone,
  MIN(created_at) as created_at,
  MAX(updated_at) as updated_at
FROM bookings
WHERE user_id IS NULL
  AND contact_phone IS NOT NULL
GROUP BY contact_phone
ON CONFLICT (phone) DO NOTHING;  -- защита от дубликатов

-- 2.2 Связываем гостевые брони с новыми users
-- Все брони где user_id = NULL и есть contact_phone → привязываем к guest user
UPDATE bookings b
SET user_id = u.id
FROM users u
WHERE b.user_id IS NULL
  AND b.contact_phone IS NOT NULL
  AND u.phone = b.contact_phone
  AND u.email IS NULL;  -- только guest users (дополнительная проверка)

-- ============================================================================
-- Комментарии
-- ============================================================================

COMMENT ON COLUMN users.email IS 'Email пользователя. NULL для гостевых аккаунтов';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hash пароля. NULL для гостевых аккаунтов';
COMMENT ON COLUMN users.phone IS 'Телефон в формате 7XXXXXXXXXX. UNIQUE для предотвращения дубликатов гостей';

-- ============================================================================
-- Verification queries (запустить после миграции)
-- ============================================================================

-- Проверка 1: Все гостевые брони теперь имеют user_id
-- SELECT COUNT(*) FROM bookings WHERE user_id IS NULL AND contact_phone IS NOT NULL;
-- Ожидаемо: 0

-- Проверка 2: Гостевые users созданы
-- SELECT COUNT(*) FROM users WHERE email IS NULL;
-- Ожидаемо: N (по числу уникальных contact_phone)

-- Проверка 3: Нет дубликатов phone
-- SELECT phone, COUNT(*) FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1;
-- Ожидаемо: 0 rows

-- Проверка 4: CHECK constraint работает
-- Должна упасть с ошибкой:
-- INSERT INTO users (id, email, password_hash, phone) VALUES (gen_random_uuid(), NULL, NULL, NULL);
-- ERROR: check constraint "check_guest_or_registered" violated

-- ============================================================================
-- Rollback скрипт (если что-то пошло не так)
-- ============================================================================

/*
BEGIN;

-- Откат связи user_id в bookings для гостей
UPDATE bookings SET user_id = NULL
WHERE user_id IN (SELECT id FROM users WHERE email IS NULL);

-- Удаление guest users
DELETE FROM users WHERE email IS NULL;

-- Откат constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_guest_or_registered;
DROP INDEX IF EXISTS idx_users_phone_unique;
DROP INDEX IF EXISTS idx_users_email_unique;

-- Восстановление старых constraints (если были)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
CREATE UNIQUE INDEX users_email_key ON users(email);

COMMIT;
*/
