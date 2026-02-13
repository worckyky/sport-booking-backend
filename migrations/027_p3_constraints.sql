-- Migration 027: P3 constraints & indexes
-- DB-06: CHECK constraint on fields.slot_duration (valid range 15-480 min)
-- DB-08: Composite index users(campaign_id, invited_by) for team queries

-- DB-06: Enforce slot_duration range at DB level
ALTER TABLE public.fields
ADD CONSTRAINT check_slot_duration CHECK (slot_duration >= 15 AND slot_duration <= 480);

-- DB-08: Composite index for team member lookups by campaign
CREATE INDEX IF NOT EXISTS idx_users_campaign_invited_by
ON public.users(campaign_id, invited_by);
