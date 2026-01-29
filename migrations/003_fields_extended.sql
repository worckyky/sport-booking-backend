-- Расширение таблицы fields по документации
-- Добавляем все поля для полноценного управления полями и генерации слотов

-- 1. Добавляем колонки в fields
ALTER TABLE public.fields
ADD COLUMN IF NOT EXISTS sport_types TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS is_indoor BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS photos TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS slot_duration INTEGER NOT NULL DEFAULT 60,
ADD COLUMN IF NOT EXISTS working_hours_from TIME,
ADD COLUMN IF NOT EXISTS working_hours_to TIME,
ADD COLUMN IF NOT EXISTS working_days TEXT[] DEFAULT ARRAY['mon','tue','wed','thu','fri','sat','sun'],
ADD COLUMN IF NOT EXISTS client_info TEXT;

-- 2. Индекс по статусу для фильтрации
CREATE INDEX IF NOT EXISTS idx_fields_status ON public.fields(status);

-- 3. Добавляем колонки блокировки в slots
ALTER TABLE public.booking_slots
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS block_reason TEXT;

-- 4. Индекс по статусу бронирования
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);

-- Комментарии
COMMENT ON COLUMN public.fields.sport_types IS 'Виды спорта: FOOTBALL, TENNIS, BASKETBALL, etc.';
COMMENT ON COLUMN public.fields.is_indoor IS 'true = крытое, false = открытое';
COMMENT ON COLUMN public.fields.photos IS 'URL фотографий (минимум 1)';
COMMENT ON COLUMN public.fields.status IS 'active/disabled/hidden';
COMMENT ON COLUMN public.fields.slot_duration IS 'Длительность слота в минутах: 60/90/120';
COMMENT ON COLUMN public.fields.working_hours_from IS 'Начало работы, например 08:00';
COMMENT ON COLUMN public.fields.working_hours_to IS 'Конец работы, например 22:00';
COMMENT ON COLUMN public.fields.working_days IS 'Рабочие дни: mon,tue,wed,thu,fri,sat,sun';
COMMENT ON COLUMN public.fields.client_info IS 'Информация для клиента (до 500 символов)';
COMMENT ON COLUMN public.booking_slots.is_blocked IS 'Слот заблокирован площадкой';
COMMENT ON COLUMN public.booking_slots.block_reason IS 'Причина блокировки';
