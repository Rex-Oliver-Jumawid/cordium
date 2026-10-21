"use strict";
const crypto = require("node:crypto");
const QRCode = require("qrcode");
const { query, first, route, user, schedule, record, fail } = require("./db");

const MASS_TYPES = ["Sunday Mass", "Weekday Mass", "Special Mass", "Other"];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function manilaClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (key) => parts.find((x) => x.type === key).value;
  const dateString = [value("year"), value("month"), value("day")].join("-");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { date: dateString, day: days.indexOf(value("weekday")),
    time: value("hour") + ":" + value("minute") };
}

function currentSchedule(schedules, now = new Date()) {
  const clock = manilaClock(now);
  return schedules.find((s) =>
    s.is_active && clock.time >= s.start_time && clock.time <= s.end_time &&
    (s.schedule_type === "specific"
      ? String(s.specific_date).slice(0, 10) === clock.date
      : (s.day_of_week || []).includes(clock.day))) || null;
}

function validateSchedule(input) {
  const x = input || {};
  if (!x.name || !MASS_TYPES.includes(x.massType) || !["recurring","specific"].includes(x.scheduleType)
    || !TIME_RE.test(x.startTime || "") || !TIME_RE.test(x.endTime || "")
    || x.endTime <= x.startTime) fail("Invalid schedule data");
  if (x.scheduleType === "recurring" && (!Array.isArray(x.dayOfWeek) || !x.dayOfWeek.length ||
    x.dayOfWeek.some((n) => !Number.isInteger(n) || n < 0 || n > 6))) {
    fail("Choose at least one valid day for a recurring schedule");
  }
  if (x.scheduleType === "specific" && !/^\d{4}-\d{2}-\d{2}$/.test(String(x.specificDate || "").slice(0,10))) {
    fail("Specific date is required");
  }
  const dates = x.scheduleType === "specific" ? [] : x.dayOfWeek;
  return {
    name: String(x.name).trim(), mass_type: x.massType,
    schedule_type: x.scheduleType, day_of_week: dates,
    specific_date: x.scheduleType === "specific" ? String(x.specificDate).slice(0,10) : null,
    start_time: x.startTime, end_time: x.endTime, is_active: x.isActive !== false,
  };
}

function installCore(app, protect, roles) {
  app.get("/api/mass-schedules/current", route(async (_req, res) => {
    const rows = (await query("SELECT * FROM public.mass_schedules WHERE is_active = true")).rows;
    res.json({ success: true, schedule: schedule(currentSchedule(rows)),
      message: "Current church schedule" });
  }));

  const listSchedules = route(async (req, res) => {
    const params = [];
    let where = "";
    if (req.query.active !== undefined) {
      params.push(req.query.active === "true");
      where = " WHERE is_active = $1";
    }
    const rows = (await query("SELECT * FROM public.mass_schedules" + where +
      " ORDER BY created_at DESC", params)).rows;
    res.json({ success: true, count: rows.length, schedules: rows.map(schedule) });
  });
  app.get("/api/mass-schedules", protect, roles("moderator","admin"), listSchedules);
  app.get("/api/admin/mass-schedules", protect, roles("admin"), listSchedules);

  const createSchedule = route(async (req, res) => {
    const x = validateSchedule(req.body);
    const row = first(await query(
      "INSERT INTO public.mass_schedules (name,mass_type,schedule_type,day_of_week," +
      "specific_date,start_time,end_time,is_active,created_by) VALUES " +
      "($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [x.name,x.mass_type,x.schedule_type,x.day_of_week,x.specific_date,
        x.start_time,x.end_time,x.is_active,req.actor.id]));
    res.status(201).json({ success: true, message: "Schedule created successfully",
      schedule: schedule(row), emailSent: false });
  });
  app.post("/api/mass-schedules", protect, roles("admin"), createSchedule);
  app.post("/api/admin/mass-schedules", protect, roles("admin"), createSchedule);

  const updateSchedule = route(async (req, res) => {
    const old = first(await query("SELECT * FROM public.mass_schedules WHERE id=$1", [req.params.id]));
    if (!old) fail("Schedule not found", 404);
    const x = validateSchedule({
      name: req.body.name ?? old.name, massType: req.body.massType ?? old.mass_type,
      scheduleType: req.body.scheduleType ?? old.schedule_type,
      dayOfWeek: req.body.dayOfWeek ?? old.day_of_week,
      specificDate: req.body.specificDate ?? old.specific_date,
      startTime: req.body.startTime ?? old.start_time,
      endTime: req.body.endTime ?? old.end_time,
      isActive: req.body.isActive ?? old.is_active,
    });
    const updated = first(await query(
      "UPDATE public.mass_schedules SET name=$1,mass_type=$2,schedule_type=$3," +
      "day_of_week=$4,specific_date=$5,start_time=$6,end_time=$7,is_active=$8 " +
      "WHERE id=$9 RETURNING *",
      [x.name,x.mass_type,x.schedule_type,x.day_of_week,x.specific_date,
        x.start_time,x.end_time,x.is_active,req.params.id]));
    res.json({ success: true, message: "Schedule updated", schedule: schedule(updated) });
  });
  app.put("/api/mass-schedules/:id", protect, roles("admin"), updateSchedule);
  app.put("/api/admin/mass-schedules/:id", protect, roles("admin"), updateSchedule);

  const deleteSchedule = route(async (req, res) => {
    const result = await query("DELETE FROM public.mass_schedules WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rowCount) fail("Schedule not found", 404);
    res.json({ success: true, message: "Schedule deleted" });
  });
  app.delete("/api/mass-schedules/:id", protect, roles("admin"), deleteSchedule);
  app.delete("/api/admin/mass-schedules/:id", protect, roles("admin"), deleteSchedule);

  app.post("/api/moderator/users/register", protect, roles("admin","moderator"), route(async (req,res) => {
    const { firstName, lastName, email, phoneNumber } = req.body || {};
    if (![firstName,lastName,email].every((x) => typeof x === "string" && x.trim())) {
      fail("First name, last name and email are required");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Invalid email");
    if (phoneNumber && !/^(\+63|0)9\d{9}$/.test(phoneNumber)) fail("Invalid mobile number");
    const qr = crypto.randomBytes(32).toString("hex");
    const image = await QRCode.toDataURL(qr);
    const result = await query(
      "INSERT INTO public.users (first_name,last_name,email,phone_number,role,qr_code,qr_code_image) " +
      "VALUES ($1,$2,$3,$4,'member',$5,$6) RETURNING *",
      [firstName.trim(),lastName.trim(),email.toLowerCase().trim(),phoneNumber || null,qr,image]);
    res.status(201).json({ success: true, message: "Member registered", data: user(first(result)) });
  }));

  app.get("/api/moderator/users", protect, roles("admin","moderator"), route(async (_req,res) => {
    const rows = (await query("SELECT * FROM public.users ORDER BY created_at DESC LIMIT 10000")).rows;
    res.json({ success: true, count: rows.length, data: rows.map(user) });
  }));

  app.patch("/api/moderator/users/:id/status", protect, roles("admin","moderator"), route(async (req,res) => {
    if (typeof req.body?.isActive !== "boolean") fail("isActive must be boolean");
    const x = first(await query("SELECT role FROM public.users WHERE id=$1", [req.params.id]));
    if (!x) fail("User not found",404);
    if (x.role !== "member") fail("Only members can be changed from the moderator dashboard",403);
    const next = first(await query("UPDATE public.users SET is_active=$1 WHERE id=$2 RETURNING *",
      [req.body.isActive,req.params.id]));
    res.json({ success:true, data:user(next), message:"Member status updated" });
  }));

  app.post("/api/moderator/scan", protect, roles("admin","moderator"), route(async (req,res) => {
    const { qrCode, scheduleId, notes } = req.body || {};
    if (!qrCode || !scheduleId) fail("QR code and schedule are required");
    const member = first(await query("SELECT * FROM public.users WHERE qr_code=$1", [qrCode]));
    if (!member || !member.is_active || member.role !== "member") fail("Invalid or inactive member QR code",404);
    const sched = first(await query("SELECT * FROM public.mass_schedules WHERE id=$1", [scheduleId]));
    if (!sched) fail("Schedule not found",404);
    // DB uniqueness index serializes competing scans for the same Manila date.
    const row = first(await query(
      "INSERT INTO public.attendance_records (user_id,moderator_id,schedule_id,mass_type," +
      "notes,attendance_date) VALUES ($1,$2,$3,$4,$5,(now() AT TIME ZONE 'Asia/Manila')::date) RETURNING *",
      [member.id,req.actor.id,sched.id,sched.mass_type,notes || null]));
    res.status(201).json({ success:true, message:"Attendance recorded successfully",
      record:{ id:row.id,
        user:{ id:member.id,name:member.first_name+" "+member.last_name },
        moderator:{ id:req.actor.id,name:req.actor.first_name+" "+req.actor.last_name },
        massType:row.mass_type,scannedAt:row.scanned_at,notes:row.notes } });
  }));

  app.get("/api/moderator/attendance/recent", protect, roles("admin","moderator"), route(async (req,res) => {
    const count = Math.max(1,Math.min(100,parseInt(req.query.limit,10) || 20));
    const days = req.query.range === "month" ? 30 : req.query.range === "week" ? 7 : 1;
    const rows = (await query(
      "SELECT a.*, u.first_name,u.last_name,u.email FROM public.attendance_records a " +
      "JOIN public.users u ON u.id=a.user_id WHERE a.scanned_at >= now()-($1::int * interval '1 day') " +
      "ORDER BY a.scanned_at DESC LIMIT $2", [days,count])).rows;
    res.json({ success:true,records:rows.map((r) => ({
      ...record(r),userId:{_id:r.user_id,firstName:r.first_name,lastName:r.last_name,email:r.email},
    })) });
  }));

  app.get("/api/moderator/sessions/active", protect, roles("admin","moderator"), route(async (_req,res) => {
    const rows = (await query(
      "SELECT s.*,u.first_name,u.last_name FROM public.attendance_sessions s " +
      "JOIN public.users u ON u.id=s.user_id WHERE status='active' AND expires_at > now() " +
      "ORDER BY generated_at DESC LIMIT 100")).rows;
    const sessions = rows.map((r) => ({
      _id:r.id,userId:{_id:r.user_id,firstName:r.first_name,lastName:r.last_name},
      status:r.status,generatedAt:r.generated_at,expiresAt:r.expires_at,massType:r.mass_type,
    }));
    res.json({success:true,count:sessions.length,sessions});
  }));

  app.get("/api/moderator/stats", protect, roles("admin","moderator"), route(async (req,res) => {
    const start = req.query.startDate || new Date(Date.now()-86400000).toISOString();
    const end = req.query.endDate || new Date().toISOString();
    const stats = (await query(
      "SELECT mass_type AS type, COUNT(*)::int AS count FROM public.attendance_records " +
      "WHERE moderator_id=$1 AND scanned_at BETWEEN $2 AND $3 GROUP BY mass_type",
      [req.actor.id,start,end])).rows;
    res.json({success:true,stats:{totalScans:stats.reduce((a,b)=>a+b.count,0),
      massTypeBreakdown:stats.map((x)=>({_id:x.type,count:x.count})),
      period:{startDate:start,endDate:end}}});
  }));

  app.get("/api/moderator/schedules/:scheduleId/attendees", protect, roles("admin","moderator"), route(async (req,res) => {
    const attendance = (await query(
      "SELECT a.*,u.first_name,u.last_name,u.email,u.qr_code FROM public.attendance_records a " +
      "JOIN public.users u ON a.user_id=u.id WHERE a.schedule_id=$1 ORDER BY scanned_at DESC",
      [req.params.scheduleId])).rows;
    const contributions = (await query(
      "SELECT c.*,u.first_name,u.last_name FROM public.contributions c " +
      "JOIN public.users u ON c.user_id=u.id WHERE c.schedule_id=$1 ORDER BY date DESC",
      [req.params.scheduleId])).rows;
    res.json({success:true,attendees:attendance.map((x)=>({
      ...record(x),userName:x.first_name+" "+x.last_name,userEmail:x.email,qrCode:x.qr_code,
    })),contributions});
  }));
}
module.exports = { installCore, currentSchedule, manilaClock, validateSchedule };
