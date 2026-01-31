-- Добавление контактных полей в бронирования
-- Позволяет:
-- 1. Предзаполнять из профиля, но редактировать
-- 2. Создавать брони без привязки к user (для админа)
-- 3. В будущем связывать по телефону после верификации

-- Добавляем контактные поля
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS contact_name TEXT,
ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- Делаем user_id nullable (для гостевых бронирований)
ALTER TABLE public.bookings
ALTER COLUMN user_id DROP NOT NULL;

-- Индекс для поиска по телефону (для будущей связки)
CREATE INDEX IF NOT EXISTS idx_bookings_contact_phone ON public.bookings(contact_phone);

COMMENT ON COLUMN public.bookings.contact_name IS 'Имя контактного лица для брони';
COMMENT ON COLUMN public.bookings.contact_phone IS 'Телефон контактного лица для брони';
