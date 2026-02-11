-- Migration 025: Performance indexes
-- DB-01: Index для activeBookingLimit middleware + stats queries
-- DB-02: Partial index для slot queries (только не-cancelled bookings)

-- DB-01: Ускоряет подсчёт активных броней пользователя
CREATE INDEX IF NOT EXISTS idx_bookings_user_status
ON bookings(user_id, status);

-- DB-02: Ускоряет JOIN к bookings через slot_id
-- Partial index — только активные брони (excluded: cancelled*)
CREATE INDEX IF NOT EXISTS idx_bookings_slot_active
ON bookings(slot_id)
WHERE status NOT IN ('cancelled_by_user', 'cancelled_by_facility', 'cancelled_by_admin');
