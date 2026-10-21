"use strict";
// Invite imported staff into Supabase Auth; never copies legacy passwords.
// Default is read-only. --apply sends emails and writes auth_user_id.
const { query, PROJECT_REF, getPool } = require("../backend/src/supabase/db");
const { authClient } = require("../backend/src/supabase/auth");

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.slice(2).some((arg) => arg !== "--apply" && arg !== "--plan") ||
      (apply && process.argv.includes("--plan"))) {
    throw new Error("Usage: node scripts/invite-staff.js [--plan|--apply]");
  }
  const rows=(await query(
    "SELECT id,email,role FROM public.users WHERE role IN ('admin','moderator') " +
    "AND auth_user_id IS NULL ORDER BY created_at,id")).rows;
  console.log("Cordium project: "+PROJECT_REF);
  console.log("Imported staff awaiting Supabase Auth: "+rows.length);
  if (!apply) {
    console.log("Read-only preflight. No invitation emails sent.");
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be configured server-side.");
  }
  const base = process.env.FRONTEND_URL;
  if (!base || !base.startsWith("https://")) {
    throw new Error("FRONTEND_URL must be the live HTTPS Cordium origin.");
  }
  const redirectTo=new URL("/html/reset-password.html",base).toString();
  const sb=authClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
  let completed=0;
  for (const row of rows) {
    // Invite API may be email-rate-limited. Stop on first error;
    // already-linked staff are skipped safely on the next run.
    const {data,error}=await sb.auth.admin.inviteUserByEmail(row.email,{redirectTo});
    if (error || !data?.user?.id) {
      throw new Error("Unable to invite staff member "+(completed+1)+
        ". Configure Supabase Auth SMTP and re-run. Cause: "+
        (error?.message || "No Auth user returned"));
    }
    const updated=await query(
      "UPDATE public.users SET auth_user_id=$1 WHERE id=$2 AND auth_user_id IS NULL RETURNING id",
      [data.user.id,row.id]);
    if (!updated.rowCount) {
      throw new Error("Invitation succeeded but profile link was not written. " +
        "Review Supabase Auth and the staff profile before retrying.");
    }
    completed++;
  }
  console.log("Invitations sent and profiles linked: "+completed);
}
main().catch((error)=>{
  console.error("Staff migration failed:",error.message);
  process.exitCode=1;
}).finally(async()=>{
  // Pool connections must be closed so CLI exits cleanly.
  if (process.env.SUPABASE_DATABASE_URL) {
    try { await getPool().end(); } catch (_) {}
  }
});
