# Cordium migration to Supabase and Vercel

## Status

This is a staged conversion. The existing Express controllers still use
MongoDB/Mongoose. The SQL schema is a reference, NOT a live migration.
Do not deploy the old MongoDB backend with Supabase environment variables.

The PostgreSQL schema is in ../supabase/schema.sql. Its seven tables map to
the seven original Mongoose models:

| Mongoose model | PostgreSQL table |
| --- | --- |
| User | users |
| MassSchedule | mass_schedules |
| AttendanceSession | attendance_sessions (legacy only) |
| AttendanceRecord | attendance_records |
| ModeratorAssignment | moderator_assignments |
| Contribution | contributions |
| Expense | expenses |

## Important compatibility decisions

- User records use UUID primary keys and preserve original ObjectIds in
  legacy_mongo_id for repeatable and auditable import.
- Only staff who log in need to be linked to Supabase Auth via auth_user_id.
  Members can exist as records without logging in.
- The user role remains in a server-managed database row. The browser
  must never be allowed to promote itself to admin.
- Supabase Auth must manage staff credentials. Existing Mongo bcrypt hashes
  must not be copied into app tables; set up invites or password resets.
- Member QR codes retain their permanent opaque tokens. Generate new tokens
  with cryptographic randomness on the trusted server.
- Monetary values use numeric(12,2) for precision. Amount 0 remains valid
  for backwards compatibility.
- Duplicate scans for the same schedule/user/calendar day are rejected by
  a unique index. Attendance dates use Asia/Manila, not UTC.
- Old attendance sessions are modeled only for historical migration.
- No email app password field exists in the new database. Use server-side
  secrets and an appropriate email provider.
- Time strings stay as HH:MM strings to preserve the frontend's forms.
- The Data API denies anon and authenticated clients table access.
  A trusted Express backend uses the Supabase service role only server-side
  AFTER checking user Auth tokens and database roles.

## Isolated Supabase setup

Use a dedicated NEW Cordium project. Do not apply this SQL to Prometheus-DX,
PiercingCorner, IloveTaguigECS, or dental-clinic-sys.

When the Supabase CLI is available, initialize a project migration using
the supported CLI command:

    supabase migration new initial_cordium_schema

Copy the reviewed contents of ../supabase/schema.sql into the resulting
CLI-generated migration file, link the new Cordium project, and apply through
the CLI after confirming the correct project ID. This repository file alone
does not create tables in any Supabase project.

The project URL and Supabase service key must be configured as environment
secrets on the backend and Vercel. Never commit them to Git or expose
a service key to client JavaScript.

## Migration and verification sequence

1. Export and back up the old MongoDB data, if preservation is required.
2. Apply the reviewed SQL to an empty, dedicated Cordium database.
3. Convert backend auth to Supabase Auth and validate a user via getUser on
   each request. Load the linked user row and check admin/moderator roles
   on the server, not in browser-controlled metadata.
4. Convert user management and QR attendance controllers, preserving REST
   paths and response shapes used by the existing frontend.
5. Convert mass schedules, contributions, expenses, and reporting queries.
6. Migrate data in FK order: users, schedules, legacy attendance sessions,
   attendance records, moderator assignments, contributions, expenses.
7. Reconcile record counts and the precise total contributions/expenses.
   Investigate legacy duplicate scans instead of silently dropping records.
8. Move the public HTML/CSS/JS/images/favicon assets into Vercel's public
   directory, export the Express app, and configure one Vercel project.
9. Test staff login, token refresh/logout, QR scans, report totals,
   absence email, permissions, and Vercel preview before production.

## Source security issues to resolve

- A previous version of backend/create-admin.js contained a literal password.
  Even after removing it from the branch, the secret remains in Git history.
  Rotate any reused credential.
- The old Express static configuration exposed the repository's parent
  folder, potentially exposing backend source files.
- The old system stores a Gmail app password in the Mongo user model.
  Eliminate this storage pattern before switching on production email.
- A moderator status action uses PUT on the frontend and PATCH on the
  backend. Add a route contract test and correct the mismatch.
- There is no automated test suite in the original package.json.

## Acceptance criteria

- Independent Supabase project with validated schema and RLS.
- Working staff login and role-protected routes, including token expiration.
- Permanent QR scan and same-day duplicate/concurrent scan protection.
- Accurate finance, schedules, and attendance reports after import.
- No ability to read or mutate protected tables as anon/authenticated.
- No credentials in Git or publicly served files.
- Passing preview E2E verification before Vercel production deploy.

This branch supplies schema and initial security fixes. It does not yet
include a live Supabase project, converted controllers, migrated records,
or a deployed Vercel website.
