-- Добавляем поле комментария к бронированиям

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS comment TEXT;

COMMENT ON COLUMN public.bookings.comment IS 'Комментарий клиента при бронировании (опционально)';
