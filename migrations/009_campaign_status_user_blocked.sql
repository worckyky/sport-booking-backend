-- Migration 009: Campaign status and user blocking
-- ADM-01, ADM-02, ADM-03

-- Create campaign_status enum
DO $$ BEGIN
  CREATE TYPE public.campaign_status AS ENUM ('draft', 'pending', 'published', 'suspended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add status column to campaign_info (default 'published' for existing records)
ALTER TABLE public.campaign_info
ADD COLUMN IF NOT EXISTS status public.campaign_status NOT NULL DEFAULT 'published';

-- Add is_blocked column to users (default false)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

-- Create index for filtering campaigns by status
CREATE INDEX IF NOT EXISTS idx_campaign_info_status ON public.campaign_info(status);

-- Create index for filtering blocked users
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON public.users(is_blocked) WHERE is_blocked = true;

COMMENT ON COLUMN public.campaign_info.status IS 'Campaign status: draft (not visible), pending (on moderation), published (visible), suspended (blocked by admin)';
COMMENT ON COLUMN public.users.is_blocked IS 'Whether user is blocked by admin (cannot create bookings)';
