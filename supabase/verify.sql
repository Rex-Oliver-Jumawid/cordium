-- Run AFTER applying schema.sql to the isolated Cordium Supabase project.
-- Read-only checks; fail fast if protected tables are missing or exposed.
DO $$
DECLARE
  table_name text;
  api_role text;
  rel regclass;
  protected boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'mass_schedules', 'attendance_sessions', 'attendance_records',
    'moderator_assignments', 'contributions', 'expenses'
  ] LOOP
    rel := to_regclass(format('public.%I', table_name));
    IF rel IS NULL THEN
      RAISE EXCEPTION 'Missing Cordium table: %', table_name;
    END IF;
    SELECT c.relrowsecurity INTO protected FROM pg_class c WHERE c.oid = rel;
    IF NOT protected THEN
      RAISE EXCEPTION 'RLS is disabled on %', table_name;
    END IF;

    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(api_role, rel, 'SELECT')
        OR has_table_privilege(api_role, rel, 'INSERT')
        OR has_table_privilege(api_role, rel, 'UPDATE')
        OR has_table_privilege(api_role, rel, 'DELETE') THEN
        RAISE EXCEPTION 'Unexpected Data API grants: %.%', api_role, table_name;
      END IF;
    END LOOP;

    IF NOT has_table_privilege('service_role', rel, 'SELECT') THEN
      RAISE EXCEPTION 'Missing server-side access to %', table_name;
    END IF;
  END LOOP;

  IF to_regclass('public.attendance_records_schedule_daily_unique') IS NULL THEN
    RAISE EXCEPTION 'Missing duplicate attendance protection index';
  END IF;
  IF to_regclass('public.users_email_lower_unique') IS NULL THEN
    RAISE EXCEPTION 'Missing case-insensitive unique email index';
  END IF;
  RAISE NOTICE 'Cordium schema checks passed: 7 tables protected';
END;
$$;
