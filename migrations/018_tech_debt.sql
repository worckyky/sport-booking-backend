-- Tech debt: композитный индекс + CHECK constraint на booking status

-- TD-03: Композитный индекс для самого частого запроса (getSlotsByFieldAndDate)
CREATE INDEX IF NOT EXISTS idx_slots_field_date ON booking_slots(field_id, date);

-- TD-04: CHECK constraint на booking status (campaign_info.status уже ограничен PG ENUM)
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'no_show', 'rejected', 'expired', 'cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin'));
