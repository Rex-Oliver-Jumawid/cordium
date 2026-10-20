"use strict";
// Decrypt + validate a MongoDB snapshot; import only with explicit --apply.
// Never connects to or writes to the original MongoDB database.
const crypto = require("node:crypto");
const { EJSON } = require("mongodb");
const { Client } = require("pg");
const { readEncrypted } = require("./backup-utils");

const TARGET_REF = "fmvvvdrjwkjqytdamrcp";
const NAMES = ["users", "massschedules", "attendancesessions",
  "attendancerecords", "moderatorassignments", "contributions", "expenses"];
const TABLES = ["users", "mass_schedules", "attendance_sessions",
  "attendance_records", "moderator_assignments", "contributions", "expenses"];

function idOf(collection, legacyId) {
  if (!legacyId) throw new Error("Missing legacy ID in " + collection);
  const value = String(legacyId);
  if (!/^[0-9a-f]{24}$/i.test(value)) throw new Error("Invalid Mongo ID in " + collection);
  const b = crypto.createHash("sha256").update("cordium:" + collection + ":" + value).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return h.slice(0,8) + "-" + h.slice(8,12) + "-" + h.slice(12,16) + "-" + h.slice(16,20) + "-" + h.slice(20);
}

function iso(value, fallback) {
  const d = value ? new Date(value) : fallback ? new Date(fallback) : null;
  if (!d || Number.isNaN(d.getTime())) throw new Error("Invalid or missing date: " + value);
  return d.toISOString();
}
function manilaDay(isoDate) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoDate));
}
function ref(coll, value, required = true) {
  if (!value) {
    if (required) throw new Error("Missing required reference: " + coll);
    return null;
  }
  return idOf(coll, value);
}
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 9999999999.99 ||
      Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) {
    throw new Error("Invalid amount (must have at most 2 decimals): " + value);
  }
  return n.toFixed(2);
}
function getDate(d, field, fallback) { return iso(d[field], fallback); }
function safeText(v) { return v == null ? null : String(v); }
function objectId(v) { return String(v._id); }

function convert(name, d, at) {
  const common = { id: idOf(name, d._id), legacy_mongo_id: objectId(d) };
  if (name === "users") return {
    ...common, auth_user_id: null,
    username: safeText(d.username), email: String(d.email || "").trim().toLowerCase(),
    role: d.role || "member", first_name: String(d.firstName || ""),
    last_name: String(d.lastName || ""), phone_number: safeText(d.phoneNumber),
    is_active: d.isActive !== false, qr_code: safeText(d.qrCode),
    qr_code_image: safeText(d.qrCodeImage),
    created_at: getDate(d, "createdAt", at), updated_at: getDate(d, "updatedAt", at),
  };
  if (name === "massschedules") return {
    ...common, name: d.name, mass_type: d.massType, schedule_type: d.scheduleType || "recurring",
    day_of_week: d.scheduleType === "specific" ? [] : (d.dayOfWeek || []),
    specific_date: d.scheduleType === "specific" ? manilaDay(iso(d.specificDate)) : null,
    start_time: d.startTime, end_time: d.endTime, is_active: d.isActive !== false,
    created_by: ref("users", d.createdBy), created_at: getDate(d, "createdAt", at),
    updated_at: getDate(d, "updatedAt", at),
  };
  if (name === "attendancesessions") return {
    ...common, user_id: ref("users", d.userId),
    qr_code: d.qrCode, qr_code_image: d.qrCodeImage, mass_type: d.massType,
    schedule_id: ref("massschedules", d.scheduleId, false),
    status: d.status || "active", generated_at: getDate(d, "generatedAt", at),
    expires_at: iso(d.expiresAt), used_at: d.usedAt ? iso(d.usedAt) : null,
    scanned_by: ref("users", d.scannedBy, false),
  };
  if (name === "attendancerecords") {
    const scannedAt = getDate(d, "scannedAt", at);
    return {
      ...common, user_id: ref("users", d.userId),
      session_id: ref("attendancesessions", d.sessionId, false),
      schedule_id: ref("massschedules", d.scheduleId, false),
      moderator_id: ref("users", d.moderatorId),
      mass_date: getDate(d, "massDate", scannedAt), scanned_at: scannedAt,
      attendance_date: manilaDay(scannedAt),
      mass_type: d.massType || "Sunday Mass", notes: safeText(d.notes),
    };
  }
  if (name === "moderatorassignments") return {
    ...common, moderator_id: ref("users", d.moderatorId), assigned_by: ref("users", d.assignedBy),
    assigned_at: getDate(d, "assignedAt", at),
    is_active: d.isActive !== false, notes: safeText(d.notes),
  };
  if (name === "contributions") return {
    ...common, user_id: ref("users", d.userId), schedule_id: ref("massschedules", d.scheduleId),
    amount: money(d.amount), recorded_by: ref("users", d.recordedBy),
    date: getDate(d, "date", at), notes: safeText(d.notes),
    created_at: getDate(d, "createdAt", at), updated_at: getDate(d, "updatedAt", at),
  };
  if (name === "expenses") return {
    ...common, description: d.description, amount: money(d.amount),
    category: d.category || "Other", month: d.month, year: d.year,
    recorded_by: ref("users", d.recordedBy), date: getDate(d, "date", at),
    notes: safeText(d.notes), created_at: getDate(d, "createdAt", at),
    updated_at: getDate(d, "updatedAt", at),
  };
  throw new Error("Unexpected collection " + name);
}

async function readPlan(archivePath) {
  const records = Object.fromEntries(NAMES.map((x) => [x, []]));
  const counts = Object.fromEntries(NAMES.map((x) => [x, 0]));
  let at = null, manifest = null, sealed = false;
  for await (const entry of readEncrypted(archivePath)) {
    if (sealed) throw new Error("Data found after backup manifest.");
    if (entry.type === "header") {
      if (at || entry.version !== 1) throw new Error("Invalid backup header.");
      at = entry.createdAt;
    } else if (entry.type === "doc") {
      if (!at || !NAMES.includes(entry.collection)) throw new Error("Unexpected collection or missing header.");
      const d = EJSON.deserialize(entry.data);
      const converted = convert(entry.collection, d, at);
      records[entry.collection].push(converted);
      counts[entry.collection]++;
    } else if (entry.type === "manifest") {
      manifest = entry;
      sealed = true;
    } else throw new Error("Invalid backup entry type.");
  }
  if (!at || !manifest || JSON.stringify(counts) !== JSON.stringify(manifest.counts)) {
    throw new Error("Backup manifest mismatch or incomplete archive.");
  }
  // All relations must resolve before any writes to PostgreSQL.
  const ids = Object.fromEntries(NAMES.map((n) => [n, new Set(records[n].map((x) => x.id))]));
  const foreignKeys = {
    massschedules: { created_by: "users" },
    attendancesessions: { user_id: "users", schedule_id: "massschedules", scanned_by: "users" },
    attendancerecords: { user_id: "users", session_id: "attendancesessions",
      schedule_id: "massschedules", moderator_id: "users" },
    moderatorassignments: { moderator_id: "users", assigned_by: "users" },
    contributions: { user_id: "users", schedule_id: "massschedules", recorded_by: "users" },
    expenses: { recorded_by: "users" },
  };
  for (const [collection, keys] of Object.entries(foreignKeys)) {
    for (const row of records[collection]) {
      for (const [column, refName] of Object.entries(keys)) {
        if (row[column] && !ids[refName].has(row[column])) {
          throw new Error("Orphan " + collection + "." + column +
            ", Mongo ID " + row.legacy_mongo_id + ". No rows imported.");
        }
      }
    }
  }
  const emails = new Set();
  const usernames = new Set();
  for (const u of records.users) {
    if (emails.has(u.email)) throw new Error("Duplicate member email: " + u.email);
    emails.add(u.email);
    if (u.username) {
      const username = u.username.toLowerCase();
      if (usernames.has(username)) throw new Error("Duplicate username.");
      usernames.add(username);
    }
    if (u.qr_code && !/^[0-9a-f]{64}$/.test(u.qr_code)) {
      throw new Error("Legacy QR token does not fit schema for user " + u.legacy_mongo_id);
    }
  }
  const dailyScans = new Set();
  for (const a of records.attendancerecords) {
    if (!a.schedule_id) continue;
    const key = [a.user_id,a.schedule_id,a.attendance_date].join("|");
    if (dailyScans.has(key)) {
      throw new Error("Duplicate attendance detected for " + key +
        ". Reconcile legacy data before importing.");
    }
    dailyScans.add(key);
  }
  const cents = (rows) => rows.reduce((sum, r) =>
    sum + BigInt(Math.round(Number(r.amount) * 100)), 0n);
  const totalContributions = cents(records.contributions);
  const totalExpenses = cents(records.expenses);
  const report = { counts, totalContributionsPHP: (Number(totalContributions) / 100).toFixed(2),
    totalExpensesPHP: (Number(totalExpenses) / 100).toFixed(2),
    staffRequiringAuthInvite: records.users.filter((u) => ["admin","moderator"].includes(u.role)).length,
    sourceCreatedAt: at };
  return { records, report };
}

async function importPlan(records) {
  const connectionString = process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is required for --apply.");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Expected PostgreSQL connection URL.");
  }
  if (!url.hostname.includes(TARGET_REF) && !decodeURIComponent(url.username).includes(TARGET_REF)) {
    throw new Error("Destination is not the dedicated Cordium Supabase project. Import refused.");
  }
  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    for (const table of TABLES) {
      const result = await client.query("SELECT COUNT(*)::int AS count FROM public." + table);
      if (result.rows[0].count !== 0) {
        throw new Error("Destination " + table + " is not empty; refusing destructive or repeated import.");
      }
    }
    for (let i = 0; i < NAMES.length; i++) {
      const name = NAMES[i], table = TABLES[i], rows = records[name];
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      // Fixed table/column keys come only from convert() above, never user input.
      for (let start = 0; start < rows.length; start += 100) {
        const batch = rows.slice(start, start + 100);
        const params = [];
        const values = batch.map((row) => {
          const placeholders = columns.map((column) => {
            params.push(row[column]);
            return "$" + params.length;
          });
          return "(" + placeholders.join(",") + ")";
        });
        const query = "INSERT INTO public." + table + " (" +
          columns.map((c) => '"' + c + '"').join(",") + ") VALUES " + values.join(",");
        await client.query(query, params);
      }
    }
    // Commit ONLY after every table is successfully written.
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const archive = args.find((x) => x.startsWith("--archive="));
  if (!archive || args.some((x) => !x.startsWith("--archive=") && x !== "--plan" && x !== "--apply")) {
    throw new Error("Usage: node scripts/mongo-import.js --archive=/private/cordium.backup.enc [--plan|--apply]");
  }
  if (args.includes("--plan") && args.includes("--apply")) throw new Error("Choose exactly one mode.");
  const { records, report } = await readPlan(archive.slice("--archive=".length));
  console.log(JSON.stringify(report, null, 2));
  if (!args.includes("--apply")) {
    console.log("PREFLIGHT PASSED. No database writes performed.");
    return;
  }
  await importPlan(records);
  console.log("IMPORT COMPLETE. Original MongoDB unchanged. Staff auth invites still required.");
}
if (require.main === module) {
  main().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  });
}
module.exports = { idOf, convert, manilaDay, money, readPlan, importPlan };
