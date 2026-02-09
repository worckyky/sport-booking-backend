-- Денормализация данных в бронированиях
-- Сохраняем данные на момент создания брони для статистики
-- (на случай если поле будет удалено или изменено)

-- Добавляем денормализованные поля
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS field_name TEXT,
ADD COLUMN IF NOT EXISTS field_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS sport_type TEXT;

-- Комментарии
COMMENT ON COLUMN public.bookings.field_name IS 'Название поля на момент бронирования (денормализовано)';
COMMENT ON COLUMN public.bookings.field_price IS 'Цена поля на момент бронирования (денормализовано)';
COMMENT ON COLUMN public.bookings.sport_type IS 'Основной вид спорта на момент бронирования (денормализовано)';

-- Заполняем существующие записи данными из связанных полей
UPDATE public.bookings b
SET
    field_name = f.name,
    field_price = f.price_per_hour,
    sport_type = f.sport_types[1]
FROM public.booking_slots s
JOIN public.fields f ON s.field_id = f.id
WHERE b.slot_id = s.id
AND b.field_name IS NULL;
