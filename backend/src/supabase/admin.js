"use strict";
const { query, first, route, user, fail, transaction } = require("./db");
const { authClient } = require("./auth");
const { manilaClock } = require("./core");

function userFilter(q) {
  const where=[], params=[];
  if (q.role) { params.push(q.role); where.push("role=$"+params.length); }
  if (q.isActive !== undefined) {
    params.push(q.isActive === "true"); where.push("is_active=$"+params.length);
  }
  if (q.search) {
    params.push("%"+String(q.search).slice(0,80)+"%");
    const p="$"+params.length;
    where.push("(username ILIKE "+p+" OR email ILIKE "+p+
      " OR first_name ILIKE "+p+" OR last_name ILIKE "+p+")");
  }
  return {sql:where.length?" WHERE "+where.join(" AND "):"",params};
}

async function invite(email) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.FRONTEND_URL) {
    fail("Staff invitations are not configured",503);
  }
  const client=authClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const redirectTo=new URL("/html/reset-password.html",process.env.FRONTEND_URL).toString();
  const {data,error}=await client.auth.admin.inviteUserByEmail(email,{redirectTo});
  if (error || !data?.user) fail("Unable to invite staff. Check Auth email setup.",503);
  return data.user.id;
}

function installAdmin(app,protect,roles) {
  const admin=[protect,roles("admin")];
  app.get("/api/admin/users", ...admin, route(async (req,res) => {
    const filter=userFilter(req.query);
    const page=Math.max(1,parseInt(req.query.page,10)||1);
    const limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||20));
    const count=first(await query(
      "SELECT COUNT(*)::int AS count FROM public.users"+filter.sql,filter.params)).count;
    const rows=(await query("SELECT * FROM public.users"+filter.sql+
      " ORDER BY created_at DESC LIMIT $"+(filter.params.length+1)+
      " OFFSET $"+(filter.params.length+2),[...filter.params,limit,(page-1)*limit])).rows;
    res.json({success:true,count:rows.length,totalUsers:count,page,
      totalPages:Math.ceil(count/limit),users:rows.map(user)});
  }));

  app.get("/api/admin/users/:id", ...admin, route(async (req,res) => {
    const row=first(await query(
      "SELECT u.*,(SELECT COUNT(*)::int FROM public.attendance_records a " +
      "WHERE a.user_id=u.id) AS attendance_count FROM public.users u WHERE id=$1",
      [req.params.id]));
    if (!row) fail("User not found",404);
    res.json({success:true,user:{...user(row),attendanceCount:row.attendance_count}});
  }));

  app.put("/api/admin/users/:id/status", ...admin, route(async (req,res) => {
    if (typeof req.body?.isActive!=="boolean") fail("isActive must be boolean");
    const old=first(await query("SELECT role FROM public.users WHERE id=$1",[req.params.id]));
    if (!old) fail("User not found",404);
    if (old.role==="admin") fail("Admin account cannot be deactivated",403);
    const x=first(await query("UPDATE public.users SET is_active=$1 WHERE id=$2 RETURNING *",
      [req.body.isActive,req.params.id]));
    res.json({success:true,message:"Status updated",user:user(x)});
  }));

  // Preserve history and foreign keys even when an admin requests removal.
  app.delete("/api/admin/users/:id", ...admin, route(async (req,res) => {
    const x=first(await query(
      "UPDATE public.users SET is_active=false WHERE id=$1 AND role<>'admin' RETURNING *",
      [req.params.id]));
    if (!x) fail("Member/moderator not found; admins cannot be deleted",404);
    res.json({success:true,message:"Account deactivated; history retained"});
  }));

  app.get("/api/admin/moderators", ...admin, route(async (_req,res) => {
    const rows=(await query(
      "SELECT u.*,(SELECT COUNT(*)::int FROM public.attendance_records a " +
      "WHERE a.moderator_id=u.id) AS total_scans FROM public.users u " +
      "WHERE role='moderator' ORDER BY created_at DESC")).rows;
    res.json({success:true,count:rows.length,
      moderators:rows.map((r)=>({...user(r),totalScans:r.total_scans}))});
  }));

  app.post("/api/admin/moderators/create", ...admin, route(async (req,res) => {
    const {firstName,lastName,email,username}=req.body||{};
    if (![firstName,lastName,email,username].every(
      (x)=>typeof x==="string"&&x.trim())) fail("Names, email and username are required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Invalid email");
    const exists=first(await query("SELECT id FROM public.users WHERE lower(email)=lower($1) " +
      "OR lower(username)=lower($2)",[email,username]));
    if (exists) fail("Email or username already in use",409);
    // Invitation sends password setup link. The submitted legacy password
    // field is intentionally ignored; passwords are handled by Supabase Auth.
    const authId=await invite(email.trim().toLowerCase());
    const created=await transaction(async (run)=>{
      const x=first(await run(
        "INSERT INTO public.users (auth_user_id,first_name,last_name,email,username,role) " +
        "VALUES ($1,$2,$3,$4,$5,'moderator') RETURNING *",
        [authId,firstName.trim(),lastName.trim(),email.trim().toLowerCase(),username.trim()]));
      await run("INSERT INTO public.moderator_assignments (moderator_id,assigned_by,notes)" +
        " VALUES ($1,$2,$3)",[x.id,req.actor.id,"Invited as moderator"]);
      return x;
    });
    res.status(201).json({success:true,message:"Moderator invited to set their password",
      moderator:user(created)});
  }));

  app.post("/api/admin/moderators/assign", ...admin, route(async (req,res) => {
    const member=first(await query("SELECT * FROM public.users WHERE id=$1",[req.body?.userId]));
    if (!member || member.role!=="member" || !member.is_active) {
      fail("An active member must be selected",400);
    }
    if (req.body.username && (await query(
      "SELECT id FROM public.users WHERE lower(username)=lower($1) AND id<>$2",
      [req.body.username,member.id])).rowCount) fail("Username taken",409);
    const authId=member.auth_user_id || await invite(member.email);
    const updated=await transaction(async (run)=>{
      const x=first(await run(
        "UPDATE public.users SET role='moderator',username=COALESCE($1,username)," +
        "auth_user_id=$2 WHERE id=$3 RETURNING *",
        [req.body.username||null,authId,member.id]));
      await run("INSERT INTO public.moderator_assignments (moderator_id,assigned_by,notes)" +
        " VALUES ($1,$2,$3)",[member.id,req.actor.id,"Promoted from member"]);
      return x;
    });
    res.json({success:true,message:"Moderator invited",moderator:user(updated)});
  }));

  app.delete("/api/admin/moderators/:id", ...admin, route(async (req,res) => {
    const updated=await transaction(async (run)=>{
      const x=first(await run(
        "UPDATE public.users SET role='member',auth_user_id=NULL " +
        "WHERE id=$1 AND role='moderator' RETURNING *",[req.params.id]));
      if (!x) fail("Moderator not found",404);
      await run("UPDATE public.moderator_assignments SET is_active=false WHERE moderator_id=$1",
        [req.params.id]);
      return x;
    });
    // Existing JWT can't access staff APIs anymore because role is checked in DB.
    res.json({success:true,message:"Moderator privileges revoked",user:user(updated)});
  }));

  app.get("/api/admin/stats", ...admin, route(async (_req,res) => {
    const row=first(await query(
      "SELECT (SELECT COUNT(*)::int FROM public.users WHERE role='member' AND is_active) AS members,"+
      "(SELECT COUNT(*)::int FROM public.users WHERE role='moderator' AND is_active) AS mods,"+
      "(SELECT COUNT(*)::int FROM public.users WHERE role='admin') AS admins,"+
      "(SELECT COUNT(*)::int FROM public.attendance_records) AS attendances,"+
      "(SELECT COUNT(*)::int FROM public.attendance_records WHERE attendance_date="+
      "(now() AT TIME ZONE 'Asia/Manila')::date) AS today"));
    res.json({success:true,stats:{totalUsers:row.members,totalModerators:row.mods,
      users:{total:row.members,moderators:row.mods,admins:row.admins},
      attendance:{total:row.attendances,today:row.today},activeQRSessions:0}});
  }));

  async function attendanceForRange(range,scheduleId) {
    const days=range==="week"?7:range==="month"?30:range==="day"?1:null;
    const params=[];
    const conditions=[];
    if (days) {
      params.push(days);
      conditions.push("a.scanned_at >= now() - ($"+params.length+"::int * interval '1 day')");
    }
    if (scheduleId) {
      params.push(scheduleId);
      conditions.push("a.schedule_id=$"+params.length);
    }
    const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
    // Exact record pagination/report streaming will be added for large databases.
    return (await query(
      "SELECT a.*, u.first_name AS member_first,u.last_name AS member_last,u.email AS member_email," +
      "m.first_name AS mod_first,m.last_name AS mod_last,s.name AS schedule_name,"+
      "s.mass_type AS schedule_mass_type,s.schedule_type,s.start_time,s.end_time " +
      "FROM public.attendance_records a JOIN public.users u ON u.id=a.user_id " +
      "JOIN public.users m ON m.id=a.moderator_id " +
      "LEFT JOIN public.mass_schedules s ON s.id=a.schedule_id"+
      where+" ORDER BY a.scanned_at DESC LIMIT 10000",params)).rows;
  }

  app.get("/api/admin/reports/attendance", ...admin, route(async (req,res) => {
    const range=["day","week","month","all"].includes(req.query.range)?req.query.range:"day";
    const rows=await attendanceForRange(range,req.query.scheduleId);
    const uniqueAttendees=new Set(rows.map((r)=>r.user_id)).size;
    const bySchedule=new Map();
    for (const r of rows) {
      const id=r.schedule_id||"unknown";
      if (!bySchedule.has(id)) bySchedule.set(id,{
        scheduleId:id,scheduleName:r.schedule_name||"Other",
        massType:r.schedule_mass_type||r.mass_type,scheduleType:r.schedule_type||"specific",
        startTime:r.start_time,endTime:r.end_time,attendanceCount:0,attendees:[],
      });
      const bucket=bySchedule.get(id);
      bucket.attendanceCount++;
      bucket.attendees.push({recordId:r.id,
        userName:r.member_first+" "+r.member_last,userEmail:r.member_email,
        scannedAt:r.scanned_at,moderatorName:r.mod_first+" "+r.mod_last,
        scheduleName:r.schedule_name||r.mass_type,massType:r.mass_type});
    }
    const breakdown=[...bySchedule.values()].sort((a,b)=>
      String(a.startTime||"").localeCompare(String(b.startTime||"")));
    res.json({success:true,stats:{totalAttendance:rows.length,uniqueAttendees,
      schedulesUsed:breakdown.length},scheduleBreakdown:breakdown,data:breakdown,
      range,startDate:null,endDate:new Date().toISOString()});
  }));

  app.get("/api/admin/reports", ...admin, route(async (req,res) => {
    const rows=await attendanceForRange("all");
    const start=req.query.startDate?new Date(req.query.startDate):new Date(new Date().getFullYear(),0,1);
    const end=req.query.endDate?new Date(req.query.endDate):new Date();
    const selected=rows.filter((r)=>new Date(r.scanned_at)>=start&&new Date(r.scanned_at)<=end);
    const byType=new Map(),byUser=new Map(),byMod=new Map(),trend=new Map();
    for (const row of selected) {
      byType.set(row.mass_type,(byType.get(row.mass_type)||0)+1);
      byUser.set(row.user_id,(byUser.get(row.user_id)||0)+1);
      byMod.set(row.moderator_id,(byMod.get(row.moderator_id)||0)+1);
      const day=String(row.scanned_at).slice(0,10);
      trend.set(day,(trend.get(day)||0)+1);
    }
    const group=(map)=>[...map].map(([id,count])=>({_id:id,count}));
    res.json({success:true,report:{
      period:{startDate:start,endDate:end},
      summary:{totalAttendance:selected.length,uniqueAttendees:byUser.size,
        averageAttendancePerDay:(selected.length/Math.max(1,Math.ceil((end-start)/86400000))).toFixed(2)},
      massTypeBreakdown:group(byType),
      topAttendees:group(byUser).sort((a,b)=>b.count-a.count).slice(0,10),
      moderatorPerformance:group(byMod).map((x)=>({_id:x._id,scansCount:x.count})),
      dailyTrend:group(trend).sort((a,b)=>a._id.localeCompare(b._id)),
    }});
  }));

  app.delete("/api/admin/attendance/:id", ...admin, route(async (req,res) => {
    const deleted=await query("DELETE FROM public.attendance_records WHERE id=$1 RETURNING id",[req.params.id]);
    if (!deleted.rowCount) fail("Attendance record not found",404);
    res.json({success:true,message:"Attendance record deleted"});
  }));

  // Legacy UI previously posted Gmail app passwords to Mongo. Reject them.
  app.put("/api/admin/email-config", ...admin, (_req,res) => res.status(410).json({
    success:false,message:"Stored Gmail app passwords are no longer supported. Configure a server-side email provider.",
  }));
  app.post("/api/admin/mass-schedules/:id/send-absence-followup", ...admin,
    (_req,res)=>res.status(503).json({
      success:false,message:"Absence emails require a configured transactional email provider.",
    }));
}

module.exports = { installAdmin, userFilter, invite };
