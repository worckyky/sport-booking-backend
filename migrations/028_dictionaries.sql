-- Migration 028: Dynamic dictionaries (sport_types + facilities)
-- Переносим хардкод-enum в управляемые справочники

-- ==================== Sport Types ====================

CREATE TABLE IF NOT EXISTS public.sport_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sport_types_active ON public.sport_types(is_active, sort_order);

-- Seed initial sport types (from hardcoded enum)
INSERT INTO public.sport_types (code, name, sort_order) VALUES
  ('FOOTBALL', 'Футбол', 1),
  ('MINI_FOOTBALL', 'Мини-футбол', 2),
  ('BASKETBALL', 'Баскетбол', 3),
  ('VOLLEYBALL', 'Волейбол', 4),
  ('TENNIS', 'Теннис', 5),
  ('TABLE_TENNIS', 'Настольный теннис', 6),
  ('BADMINTON', 'Бадминтон', 7),
  ('SQUASH', 'Сквош', 8),
  ('PADEL', 'Падел', 9),
  ('HOCKEY', 'Хоккей', 10),
  ('FITNESS', 'Фитнес', 11),
  ('YOGA', 'Йога', 12),
  ('SWIMMING', 'Плавание', 13),
  ('MARTIAL_ARTS', 'Единоборства', 14),
  ('OTHER', 'Другое', 15)
ON CONFLICT (code) DO NOTHING;

-- ==================== Facilities ====================

CREATE TABLE IF NOT EXISTS public.facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facilities_active ON public.facilities(is_active, sort_order);

-- Seed initial facilities (from hardcoded enum)
INSERT INTO public.facilities (code, name, sort_order) VALUES
  ('PARKING', 'Парковка', 1),
  ('SHOWER', 'Душ', 2),
  ('LOCKER_ROOM', 'Раздевалка', 3),
  ('STORAGE', 'Камера хранения', 4),
  ('WIFI', 'Wi-Fi', 5),
  ('LIGHTING', 'Освещение', 6),
  ('STANDS', 'Трибуны', 7),
  ('MUSIC', 'Музыка', 8),
  ('AIR_CONDITIONING', 'Кондиционер', 9),
  ('HEATING', 'Отопление', 10),
  ('CAFE', 'Кафе', 11),
  ('RENTAL', 'Прокат инвентаря', 12),
  ('TRAINERS', 'Тренеры', 13),
  ('RESTROOM', 'Туалет', 14),
  ('VIDEO_SURVEILLANCE', 'Видеонаблюдение', 15)
ON CONFLICT (code) DO NOTHING;
