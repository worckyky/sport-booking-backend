-- Migration 016: Drop column-level UNIQUE on bookings.slot_id
--
-- Problem: bookings.slot_id has both a column-level UNIQUE constraint (bookings_slot_id_key)
-- AND a partial unique index (idx_bookings_slot_active from migration 012).
-- The column-level UNIQUE prevents rescheduling to slots that have cancelled/expired bookings.
-- The partial unique index already correctly handles uniqueness for active bookings only.
--
-- Fix: Drop the column-level UNIQUE, keep the partial unique index.

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_slot_id_key;
