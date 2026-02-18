-- 023: Admin audit log + platform settings

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_email TEXT,
  resource_type TEXT,
  resource_id UUID,
  changes JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_type ON admin_audit_log(event_type);
CREATE INDEX idx_audit_log_actor ON admin_audit_log(actor_id);
CREATE INDEX idx_audit_log_resource ON admin_audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_created ON admin_audit_log(created_at DESC);

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO platform_settings (key, value) VALUES
  ('booking_limit_per_user', '10'),
  ('booking_rate_limit_per_min', '5'),
  ('registration_link_ttl_days', '7'),
  ('invitation_ttl_days', '7'),
  ('default_timezone', '"Europe/Moscow"');
