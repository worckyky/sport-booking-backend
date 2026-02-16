-- Migration 030: Drop legacy enum types, migrate to TEXT[]
--
-- Проблема: миграция 028 создала динамические справочники (sport_types, facilities),
-- но колонки campaign_info.facilities и campaign_info.payment_methods остались на старых enum.
-- Новые значения из справочников (STORAGE, STANDS, MUSIC, etc.) невозможно сохранить.
--
-- Изменения:
-- 1. campaign_info.facilities: facility_type[] → TEXT[]
-- 2. campaign_info.payment_methods: payment_method_type[] → TEXT[]
-- 3. Drop enum: facility_type, payment_method_type, sport_type (мёртвый с миграции 010)

-- ============================================================================
-- Шаг 1: Конвертация facilities → TEXT[]
-- ============================================================================

ALTER TABLE campaign_info
  ALTER COLUMN facilities TYPE TEXT[]
  USING facilities::TEXT[];

ALTER TABLE campaign_info
  ALTER COLUMN facilities SET DEFAULT ARRAY[]::TEXT[];

-- ============================================================================
-- Шаг 2: Конвертация payment_methods → TEXT[]
-- ============================================================================

ALTER TABLE campaign_info
  ALTER COLUMN payment_methods TYPE TEXT[]
  USING payment_methods::TEXT[];

ALTER TABLE campaign_info
  ALTER COLUMN payment_methods SET DEFAULT ARRAY[]::TEXT[];

-- ============================================================================
-- Шаг 3: Drop legacy enum types
-- ============================================================================

DROP TYPE IF EXISTS facility_type;
DROP TYPE IF EXISTS payment_method_type;
DROP TYPE IF EXISTS sport_type;       -- мёртвый с миграции 010 (DROP COLUMN sports)
DROP TYPE IF EXISTS social_link_type; -- не используется (socials_links хранится как JSONB)
