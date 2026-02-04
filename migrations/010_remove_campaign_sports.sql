-- Remove sports column from campaign_info
-- Sports will be computed from fields.sport_types instead

ALTER TABLE campaign_info DROP COLUMN IF EXISTS sports;
