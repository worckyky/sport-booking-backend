-- Migration: Add timezone support to campaigns
-- Date: 2026-02-04

-- Add timezone_id column to campaign_info
-- Default is Europe/Moscow (covers Moscow, Kazan, etc.)
ALTER TABLE public.campaign_info
ADD COLUMN IF NOT EXISTS timezone_id VARCHAR(50) DEFAULT 'Europe/Moscow' NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.campaign_info.timezone_id IS 'IANA timezone ID (e.g., Europe/Moscow, Asia/Yekaterinburg)';

-- Index for potential filtering by timezone
CREATE INDEX IF NOT EXISTS idx_campaign_info_timezone ON public.campaign_info(timezone_id);
