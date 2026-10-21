# Cordium: MongoDB preservation and Supabase cutover

## Current status

A dedicated Cordium Supabase Free project was created in Singapore (ref: fmvvvdrjwkjqytdamrcp).
All seven PostgreSQL tables were created, verified, and protected by RLS.
The initial migration is recorded in Supabase migration history.
The new Express SQL API and Supabase Auth are implemented in this branch, and 14 automated tests passed in GitHub Actions.
The original MongoDB backend remains in the repository for rollback.

**Historical MongoDB records have not yet been copied.**
No original connection string or backup was available in connected sources.
The Supabase tables are currently empty.
Do not destroy, reset, or overwrite the original MongoDB database.

## Source and target mapping

| MongoDB collection | PostgreSQL table |
| --- | --- |
| users | public.users |
| massschedules | public.mass_schedules |
| attendancesessions | public.attendance_sessions |
| attendancerecords | public.attendance_records |
| moderatorassignments | public.moderator_assignments |
| contributions | public.contributions |
| expenses | public.expenses |

Original MongoDB ObjectIds are saved in legacy_mongo_id fields.
Deterministic UUIDs preserve all relational links in PostgreSQL.
Permanent QR tokens and images are retained.
Dates used for duplicate attendance are converted to Asia/Manila.
Money amounts must fit two decimal places, and finance totals are shown at preflight.

Passwords and stored Gmail app passwords are not imported into the new database.
The encrypted backup retains the original MongoDB source data, including legacy fields, for offline preservation.
Supabase Auth invitations are used for admins and moderators instead.

## Atlas versus local source comparison

Cordium exists in both MongoDB Atlas and a local MongoDB database.
**Never assume one is the authoritative copy by name or collection count alone.**
First run a read-only comparison, then export each database to a DIFFERENT encrypted archive.

Use a trusted computer that can access both databases.
Install Node.js 22+ and run `npm install`.
Set these environment variables privately on that machine:

- `CORDIUM_ATLAS_URI`: MongoDB Atlas connection URI using a read-only account.
- `CORDIUM_ATLAS_DB`: exact Atlas Cordium database name.
- `CORDIUM_LOCAL_URI`: local MongoDB URI using a read-only account.
- `CORDIUM_LOCAL_DB`: exact local Cordium database name.
- `CORDIUM_BACKUP_PASSPHRASE`: strong passphrase, at least 16 characters.

Never paste any URI, password, backup passphrase or archive into public chat or GitHub.
Pause writes to both source databases during comparison and export if possible.

Compare both complete source datasets:

    node scripts/compare-mongo-sources.js

Output includes counts, SHA-256 document-set fingerprints, and latest activity timestamp by collection.
It never prints member information.
Identical hashes and counts suggest matching snapshots at read time; differing hashes mean records or values differ.
**Same counts do NOT prove identical data.**
If differences exist, preserve both backups and review them before choosing a canonical source.
Do not blindly merge or overwrite either database.

Create both encrypted backups without changing their contents:

    node scripts/mongo-backup.js --source=atlas --out=../cordium-atlas.backup.enc
    node scripts/mongo-backup.js --source=local --out=../cordium-local.backup.enc

The exporter uses the explicit database names set above and refuses existing output files.
Run a `--plan` import preflight separately on BOTH archives before selecting any source:

    node scripts/mongo-import.js --archive=../cordium-atlas.backup.enc --plan
    node scripts/mongo-import.js --archive=../cordium-local.backup.enc --plan

Only select a source for `--apply` after checking that nothing unique to the other source is lost.
If the old datasets differ, prioritize reconciliation and a verified merged offline archive.
Do not import into Supabase until that reconciliation is complete.

## Export encrypted backup (read-only)

Use a trusted computer that can access the original MongoDB source.
Install Node.js 22+ and run npm install from this branch.
With two sources, use CORDIUM_ATLAS_URI + CORDIUM_ATLAS_DB or CORDIUM_LOCAL_URI + CORDIUM_LOCAL_DB as documented above.
For legacy single-source exports, use MONGODB_URI and CORDIUM_SOURCE_DB.
Use a read-only MongoDB database account if available.
Set CORDIUM_BACKUP_PASSPHRASE to a strong phrase of at least 16 characters.
Do not commit, paste publicly, or print either secret.

**Pause original MongoDB writes for the duration of the export.**
The exporter reads collections sequentially, so writes during export could produce an inconsistent snapshot.
For an active replica set, a separate point-in-time mongodump --oplog archive is also recommended.

Run:

    node scripts/mongo-backup.js --source=atlas --out=../cordium-atlas.backup.enc

The tool writes a gzip-compressed, AES-256-GCM authenticated EJSON archive.
It verifies the archive and prints its SHA-256 and per-collection counts.
Existing backups are never overwritten and temporary partial files are removed on failure.
Store the archive and passphrase separately in private locations.
Never upload the backup to public GitHub.

## Validate before importing

Use the same backup passphrase, then run:

    node scripts/mongo-import.js --archive=../cordium-atlas.backup.enc --plan

The preflight decrypts and verifies the source archive, maps references, and detects:
- Orphaned references, duplicate case-insensitive emails or usernames.
- Duplicate attendance scans in the same schedule on the same Manila calendar date.
- Unsupported QR token formats and invalid precision or negative amounts.
- Corrupt, incomplete, or modified encrypted source archives.

The report shows all seven source collection counts, finance totals in PHP, and the number of staff accounts needing Auth invitations.
No PostgreSQL writes occur in plan mode.

## Import into Cordium Supabase only

After preflight passes, configure SUPABASE_DATABASE_URL locally with the Supabase PostgreSQL transaction pooler URL for Cordium.
Its hostname or username must identify the exact project ref fmvvvdrjwkjqytdamrcp.
The importer refuses connections to other Supabase projects and refuses to run if any target table already contains rows.

Run:

    node scripts/mongo-import.js --archive=../cordium-atlas.backup.enc --apply

The import runs in a single PostgreSQL transaction.
Any SQL error triggers ROLLBACK, leaving no partial import.
The old MongoDB database is not contacted or changed by this command.

After importing, run the read-only checks in supabase/verify.sql.
Reconcile each collection count, member QR data, attendance samples, and contribution/expense totals.
Keep both the old MongoDB and the offline encrypted archive until final cutover approval.

## Migrate staff login to Supabase Auth

The new backend requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_DATABASE_URL, and server-side SUPABASE_SERVICE_ROLE_KEY.
The service key must never be embedded in browser JavaScript, included in a public repository, or exposed as NEXT_PUBLIC variables.
Configure FRONTEND_URL as the HTTPS URL of the new Cordium deployment.

After the data is imported and a tested HTTPS preview is available, configure Supabase Auth's redirect allowlist and SMTP sender.
Staff must reset their passwords through invitations.
Do not copy old Mongo bcrypt hashes or reuse exposed legacy admin passwords.

Preview eligible staff without sending email:

    node scripts/invite-staff.js --plan

After SMTP is configured, perform the invites:

    node scripts/invite-staff.js --apply

Invitations link each Supabase Auth identity to the imported user.
The new password setup page is html/reset-password.html.
The original Mongo member profiles continue to exist without needing login accounts.

## Vercel configuration

The new application entry point is root app.js.
The static build copies only html, css, js, images, and favicon into generated public/ assets.
The backend and migration scripts are never served as static assets.
Use a separate Vercel project and keep MongoDB credentials and backup passphrases off Vercel.
Configure the four Supabase environment variables and FRONTEND_URL in the Cordium project only.
Test a preview deployment before enabling production.

## Known limitations and safety

Email schedule notifications and absence follow-ups require a new transactional email provider and are not yet implemented.
The insecure stored Gmail app-password endpoint returns HTTP 410.
Public member signup and temporary QR generation are intentionally disabled in favor of moderator-issued permanent QR codes.
Existing reports currently cap retrieved records at 10,000 pending proper pagination for large deployments.
Real live E2E tests with an imported database, browser login, and QR scan are still required.
The npm-generated root lockfile should be generated and committed by npm from a trusted environment, not manually edited.
Historic Git commits contained admin credentials; rotate those credentials wherever reused.

Do not deploy to production or decommission MongoDB until:
1. The backup passes integrity and record count checks.
2. All imported records and relational references reconcile.
3. Admin/moderator Auth accounts are invited and role-checked.
4. QR scanning, expense transactions, admin reports and login work in a Vercel preview.
5. The complete acceptance test suite passes and the rollback archive is retained.
