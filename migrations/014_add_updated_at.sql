-- Add updated_at column to fields and bookings tables
-- Provides stable sorting and audit trail for record modifications

-- 1. Trigger function (reusable for any table)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Add updated_at to fields
ALTER TABLE fields ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE fields SET updated_at = created_at WHERE updated_at IS NOT NULL AND updated_at != created_at;

DROP TRIGGER IF EXISTS trigger_fields_updated_at ON fields;
CREATE TRIGGER trigger_fields_updated_at
    BEFORE UPDATE ON fields
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Add updated_at to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE bookings SET updated_at = created_at WHERE updated_at IS NOT NULL AND updated_at != created_at;

DROP TRIGGER IF EXISTS trigger_bookings_updated_at ON bookings;
CREATE TRIGGER trigger_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
