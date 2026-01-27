-- Booking module tables

-- 1. Fields (корты, залы площадки)
CREATE TABLE IF NOT EXISTS public.fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaign_info(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_per_hour DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fields_campaign ON public.fields(campaign_id);

COMMENT ON TABLE public.fields IS 'Поля/корты/залы спортивных площадок';

-- 2. Booking Slots (слоты времени)
CREATE TABLE IF NOT EXISTS public.booking_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id UUID NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(field_id, date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_slots_field ON public.booking_slots(field_id);
CREATE INDEX IF NOT EXISTS idx_slots_date ON public.booking_slots(date);

COMMENT ON TABLE public.booking_slots IS 'Временные слоты для бронирования';

-- 3. Bookings (бронирования)
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID UNIQUE NOT NULL REFERENCES public.booking_slots(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON public.bookings(slot_id);

COMMENT ON TABLE public.bookings IS 'Бронирования пользователей';
