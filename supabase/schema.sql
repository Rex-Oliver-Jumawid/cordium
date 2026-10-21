-- Cordium PostgreSQL schema for a DEDICATED Supabase project.
-- Review and run on an empty Cordium project only; never on an existing app database.
-- API access is intentionally server-only until authentication + authorization are migrated.
-- Supabase Auth manages passwords. No password hashes or Gmail app passwords are stored here.
BEGIN;

CREATE SCHEMA IF NOT EXISTS cordium_private;

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  legacy_mongo_id text UNIQUE,
  username text,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'moderator', 'admin')),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone_number text,
  is_active boolean NOT NULL DEFAULT true,
  qr_code text UNIQUE,
  qr_code_image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_min_length
    CHECK (username IS NULL OR length(btrim(username)) >= 3),
  CONSTRAINT users_email_format
    CHECK (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT users_qr_code_format
    CHECK (qr_code IS NULL OR qr_code ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX users_email_lower_unique ON public.users (lower(email));
CREATE UNIQUE INDEX users_username_lower_unique ON public.users (lower(username))
  WHERE username IS NOT NULL;
CREATE INDEX users_role_active_idx ON public.users (role, is_active);

CREATE TABLE public.mass_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id text UNIQUE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  mass_type text NOT NULL
    CHECK (mass_type IN ('Sunday Mass', 'Weekday Mass', 'Special Mass', 'Other')),
  schedule_type text NOT NULL DEFAULT 'recurring'
    CHECK (schedule_type IN ('recurring', 'specific')),
  day_of_week smallint[] NOT NULL DEFAULT '{}',
  specific_date date,
  start_time text NOT NULL
    CHECK (start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text NOT NULL
    CHECK (end_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mass_schedules_day_range CHECK (
    day_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  ),
  CONSTRAINT mass_schedules_type_fields CHECK (
    (schedule_type = 'recurring' AND cardinality(day_of_week) > 0 AND specific_date IS NULL)
    OR
    (schedule_type = 'specific' AND specific_date IS NOT NULL AND cardinality(day_of_week) = 0)
  )
);

CREATE INDEX mass_schedules_active_idx
  ON public.mass_schedules (is_active, schedule_type, specific_date);

-- Legacy short-lived QR sessions are retained for historical import only.
-- New attendance uses the permanent token on users.qr_code.
CREATE TABLE public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id text UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  qr_code text NOT NULL UNIQUE,
  qr_code_image text NOT NULL,
  mass_type text NOT NULL
    CHECK (mass_type IN ('Sunday Mass', 'Weekday Mass', 'Special Mass', 'Other')),
  schedule_id uuid REFERENCES public.mass_schedules(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'used')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  scanned_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX attendance_sessions_user_status_idx
  ON public.attendance_sessions (user_id, status);

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id text UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  schedule_id uuid REFERENCES public.mass_schedules(id) ON DELETE SET NULL,
  moderator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  mass_date timestamptz NOT NULL DEFAULT now(),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  -- Persist the church-local calendar date, not the UTC date.
  attendance_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Manila')::date),
  mass_type text NOT NULL DEFAULT 'Sunday Mass'
    CHECK (mass_type IN ('Sunday Mass', 'Weekday Mass', 'Special Mass', 'Other')),
  notes text
);

CREATE INDEX attendance_records_user_scanned_idx
  ON public.attendance_records (user_id, scanned_at DESC);
CREATE INDEX attendance_records_moderator_idx
  ON public.attendance_records (moderator_id);
CREATE INDEX attendance_records_mass_date_idx
  ON public.attendance_records (mass_date DESC);
CREATE INDEX attendance_records_schedule_idx
  ON public.attendance_records (schedule_id);
-- Concurrent duplicate scans must fail even if both requests pass an API-level check.
CREATE UNIQUE INDEX attendance_records_schedule_daily_unique
  ON public.attendance_records (user_id, schedule_id, attendance_date)
  WHERE schedule_id IS NOT NULL;

CREATE TABLE public.moderator_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id text UNIQUE,
  moderator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  notes text
);

CREATE INDEX moderator_assignments_moderator_active_idx
  ON public.moderator_assignments (moderator_id, is_active);

CREATE TABLE public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id text UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  schedule_id uuid NOT NULL REFERENCES public.mass_schedules(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  date timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contributions_schedule_date_idx
  ON public.contributions (schedule_id, date DESC);
CREATE INDEX contributions_user_date_idx
  ON public.contributions (user_id, date DESC);
CREATE INDEX contributions_date_idx ON public.contributions (date DESC);

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id text UNIQUE,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  category text NOT NULL DEFAULT 'Other'
    CHECK (category IN ('Utilities', 'Maintenance', 'Supplies', 'Events',
      'Salaries', 'Charity', 'Other')),
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 9999),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  date timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expenses_year_month_idx ON public.expenses (year DESC, month DESC);
CREATE INDEX expenses_category_date_idx ON public.expenses (category, date DESC);

-- On any update, maintain the original application's updatedAt semantics.
CREATE FUNCTION cordium_private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION cordium_private.touch_updated_at();
CREATE TRIGGER mass_schedules_touch_updated_at
  BEFORE UPDATE ON public.mass_schedules
  FOR EACH ROW EXECUTE FUNCTION cordium_private.touch_updated_at();
CREATE TRIGGER contributions_touch_updated_at
  BEFORE UPDATE ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION cordium_private.touch_updated_at();
CREATE TRIGGER expenses_touch_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION cordium_private.touch_updated_at();

-- Deny access through Supabase's REST API for browser roles.
-- For the initial migration, ONLY the trusted Express backend accesses the data.
-- A service-role secret must NEVER be placed in client-side JavaScript.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mass_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderator_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.users, public.mass_schedules, public.attendance_sessions,
  public.attendance_records, public.moderator_assignments,
  public.contributions, public.expenses
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  public.users, public.mass_schedules, public.attendance_sessions,
  public.attendance_records, public.moderator_assignments,
  public.contributions, public.expenses
TO service_role;

REVOKE ALL ON FUNCTION cordium_private.touch_updated_at() FROM PUBLIC;
GRANT USAGE ON SCHEMA cordium_private TO service_role;
GRANT EXECUTE ON FUNCTION cordium_private.touch_updated_at() TO service_role;

COMMIT;
