-- Pending changes for critical fields (name, location, media)
-- When a published campaign edits critical fields, changes go here instead of applying directly
ALTER TABLE campaign_info ADD COLUMN IF NOT EXISTS pending_changes JSONB DEFAULT NULL;

-- Status audit log — tracks all campaign status transitions
CREATE TABLE IF NOT EXISTS campaign_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaign_info(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_status_log_campaign ON campaign_status_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_status_log_created ON campaign_status_log(created_at DESC);
