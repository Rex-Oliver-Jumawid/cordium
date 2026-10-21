"use strict";
const { Pool } = require("pg");

let pool;
const PROJECT_REF = "fmvvvdrjwkjqytdamrcp";

function getPool() {
  if (!pool) {
    const connectionString = process.env.SUPABASE_DATABASE_URL;
    if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is missing");
    const url = new URL(connectionString);
    if (!url.hostname.includes(PROJECT_REF) &&
        !decodeURIComponent(url.username).includes(PROJECT_REF)) {
      throw new Error("Database connection is not the dedicated Cordium project");
    }
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", (error) => console.error("PostgreSQL idle client error:", error.message));
  }
  return pool;
}

async function query(sql, params = []) {
  return getPool().query(sql, params);
}

async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback((sql, params = []) => client.query(sql, params));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function user(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, username: row.username, email: row.email,
    firstName: row.first_name, lastName: row.last_name,
    phoneNumber: row.phone_number, role: row.role, isActive: row.is_active,
    qrCode: row.qr_code, qrCodeImage: row.qr_code_image,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function schedule(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, name: row.name,
    massType: row.mass_type, scheduleType: row.schedule_type,
    dayOfWeek: row.day_of_week, specificDate: row.specific_date,
    startTime: row.start_time, endTime: row.end_time,
    isActive: row.is_active, createdBy: row.created_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function record(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, userId: row.user_id,
    sessionId: row.session_id, scheduleId: row.schedule_id,
    moderatorId: row.moderator_id, massDate: row.mass_date,
    scannedAt: row.scanned_at, massType: row.mass_type, notes: row.notes,
  };
}

function contribution(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, userId: row.user_id,
    scheduleId: row.schedule_id, amount: Number(row.amount),
    recordedBy: row.recorded_by, date: row.date, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function expense(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, description: row.description,
    amount: Number(row.amount), category: row.category,
    month: row.month, year: row.year, recordedBy: row.recorded_by,
    date: row.date, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function route(handler) {
  return (req, res, next) => {
    Promise.resolve().then(() => handler(req, res)).catch(next);
  };
}

function first(result) { return result.rows[0] || null; }

function assertMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001 || n > 9999999999.99) {
    const error = new Error("Amount must be nonnegative with at most two decimal places");
    error.status = 400;
    throw error;
  }
  return n.toFixed(2);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

module.exports = {
  query, transaction, getPool, user, schedule, record, contribution, expense,
  route, first, assertMoney, fail, PROJECT_REF,
};
