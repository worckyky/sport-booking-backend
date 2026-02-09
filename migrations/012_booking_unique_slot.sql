-- Migration: Prevent race condition - only one active booking per slot
-- Date: 2026-02-04

-- Add partial unique index: only one non-cancelled booking per slot
-- This allows cancelled bookings to exist alongside active ones
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot_active
ON bookings (slot_id)
WHERE status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired');

-- Comment
COMMENT ON INDEX idx_bookings_slot_active IS 'Prevents race condition: only one active booking (pending/confirmed/completed/no_show) per slot';
