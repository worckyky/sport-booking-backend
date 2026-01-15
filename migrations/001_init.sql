-- Local Postgres schema (extracted from Supabase + adapted to run without Supabase)

-- Needed for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('USER', 'CAMPAIGN', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.email_status AS ENUM ('VERIFIED', 'NOT_VERIFIED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_method_type AS ENUM ('MONEY', 'CARD', 'SBP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.facility_type AS ENUM (
    'PARKING',
    'SHOWER',
    'LOCKER_ROOM',
    'WIFI',
    'LIGHTING',
    'AIR_CONDITIONING',
    'CAFE',
    'RENTAL',
    'VIDEO_SURVEILLANCE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sport_type AS ENUM ('FOOTBALL', 'BASKETBALL', 'TENNIS', 'VOLLEYBALL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.social_link_type AS ENUM ('VK', 'TELEGRAM', 'WHATS_APP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS public.campaign_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  short_description TEXT,

  location JSONB DEFAULT '{}'::jsonb,
  contacts JSONB DEFAULT '{}'::jsonb,
  working_timetable JSONB DEFAULT '{}'::jsonb,
  socials_links JSONB DEFAULT '[]'::jsonb,

  payment_methods public.payment_method_type[] DEFAULT ARRAY[]::public.payment_method_type[],
  facilities public.facility_type[] DEFAULT ARRAY[]::public.facility_type[],
  sports public.sport_type[] DEFAULT ARRAY[]::public.sport_type[],

  media JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_info_user_id ON public.campaign_info(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_info_location ON public.campaign_info USING GIN (location);
CREATE INDEX IF NOT EXISTS idx_campaign_info_sports ON public.campaign_info USING GIN (sports);

COMMENT ON TABLE public.campaign_info IS 'Информация о спортивных площадках кампаний';

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,

  role public.user_role NOT NULL DEFAULT 'USER',
  name TEXT,
  phone TEXT,
  registration_date TEXT,
  date_of_birth DATE,
  email_verified public.email_status NOT NULL DEFAULT 'NOT_VERIFIED',

  campaign_id UUID REFERENCES public.campaign_info(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DO $$ BEGIN
  ALTER TABLE public.campaign_info
    ADD CONSTRAINT campaign_info_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_campaign_id ON public.users(campaign_id);

COMMENT ON COLUMN public.users.campaign_id IS 'ID кампании, заполняется при регистрации пользователя с ролью CAMPAIGN';

-- Password reset tokens (local replacement for Supabase reset flow)
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);

