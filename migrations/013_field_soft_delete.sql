-- Migration: Soft delete for fields (preserve booking history)
-- Date: 2026-02-04

-- Add deleted_at column
ALTER TABLE public.fields
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for faster filtering of non-deleted fields
CREATE INDEX IF NOT EXISTS idx_fields_not_deleted
ON public.fields (campaign_id)
WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.fields.deleted_at IS 'Soft delete timestamp. NULL = active field';
