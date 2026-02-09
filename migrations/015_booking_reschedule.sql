-- Migration 015: Booking reschedule history
-- Таблица аудита переносов бронирований

CREATE TABLE IF NOT EXISTS booking_reschedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    old_slot_id UUID NOT NULL REFERENCES booking_slots(id),
    new_slot_id UUID NOT NULL REFERENCES booking_slots(id),
    old_field_name TEXT NOT NULL,
    new_field_name TEXT NOT NULL,
    rescheduled_by UUID NOT NULL REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reschedules_booking ON booking_reschedules(booking_id);
