"use strict";
const { query, transaction, first, route, user, contribution, expense, assertMoney, fail } = require("./db");
const CATEGORIES = ["Utilities","Maintenance","Supplies","Events","Salaries","Charity","Other"];

function populateItem(row, type) {
  const converted = type === "contribution" ? contribution(row) : expense(row);
  if (row.member_first) converted.userId = {
    _id:row.user_id,firstName:row.member_first,lastName:row.member_last,
  };
  if (row.schedule_name) converted.scheduleId = {
    _id:row.schedule_id,name:row.schedule_name,
  };
  if (row.staff_first) converted.recordedBy = {
    _id:row.recorded_by,firstName:row.staff_first,lastName:row.staff_last,
  };
  return converted;
}

async function balance(run = query) {
  const row = first(await run(
    "SELECT (SELECT COALESCE(SUM(amount),0) FROM public.contributions)::numeric AS contributions," +
    "(SELECT COALESCE(SUM(amount),0) FROM public.expenses)::numeric AS expenses"));
  return { contributions:row.contributions,expenses:row.expenses,
    availableBalance:Number(row.contributions)-Number(row.expenses) };
}

function installFinance(app, protect, roles) {
  const staff = [protect,roles("moderator","admin")];
  app.get("/api/moderator/balance", ...staff, route(async (_req,res) => {
    const b = await balance();
    res.json({ success:true,data:{totalContributions:Number(b.contributions),
      totalExpenses:Number(b.expenses),availableBalance:b.availableBalance} });
  }));

  app.get("/api/moderator/contributions", ...staff, route(async (_req,res) => {
    const rows=(await query(
      "SELECT c.*,u.first_name AS member_first,u.last_name AS member_last," +
      "s.name AS schedule_name,r.first_name AS staff_first,r.last_name AS staff_last " +
      "FROM public.contributions c " +
      "JOIN public.users u ON u.id=c.user_id JOIN public.users r ON r.id=c.recorded_by " +
      "JOIN public.mass_schedules s ON s.id=c.schedule_id ORDER BY c.date DESC LIMIT 10000"
    )).rows;
    res.json({success:true,count:rows.length,data:rows.map((r)=>populateItem(r,"contribution"))});
  }));

  app.post("/api/moderator/contributions", ...staff, route(async (req,res) => {
    const { userId,scheduleId,amount,notes }=req.body||{};
    if (!userId || !scheduleId || amount == null || amount==="") fail("Member, schedule and amount are required");
    const decimal=assertMoney(amount);
    if (decimal === "0.00") return res.json({success:true,message:"No contribution recorded",data:null});
    const row=first(await query(
      "INSERT INTO public.contributions (user_id,schedule_id,recorded_by,amount,notes) " +
      "VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [userId,scheduleId,req.actor.id,decimal,notes||null]));
    res.status(201).json({success:true,message:"Contribution recorded",data:contribution(row)});
  }));

  app.put("/api/moderator/contributions/:id", ...staff, route(async (req,res) => {
    const amount=assertMoney(req.body?.amount);
    const row=first(await query(
      "UPDATE public.contributions SET amount=$1,notes=$2 WHERE id=$3 RETURNING *",
      [amount,req.body.notes || null,req.params.id]));
    if (!row) fail("Contribution not found",404);
    res.json({success:true,message:"Contribution updated",data:contribution(row)});
  }));

  app.get("/api/moderator/expenses", ...staff, route(async (_req,res) => {
    const rows=(await query(
      "SELECT e.*,u.first_name AS staff_first,u.last_name AS staff_last " +
      "FROM public.expenses e JOIN public.users u ON u.id=e.recorded_by " +
      "ORDER BY e.date DESC LIMIT 10000")).rows;
    res.json({success:true,count:rows.length,data:rows.map((r)=>populateItem(r,"expense"))});
  }));

  app.post("/api/moderator/expenses", ...staff, route(async (req,res) => {
    const { amount,category,description,notes }=req.body||{};
    const decimal=assertMoney(amount);
    if (!CATEGORIES.includes(category)) fail("Invalid expense category");
    const result=await transaction(async (run) => {
      // Serialize all balance-sensitive writes. Important when two moderators
      // submit expenses concurrently from different devices.
      await run("SELECT pg_advisory_xact_lock(3616281, 1)");
      const b=await balance(run);
      if (Number(decimal)>b.availableBalance+0.000001) fail("Expense exceeds available balance");
      return first(await run(
        "INSERT INTO public.expenses (description,amount,category,month,year,recorded_by,notes) " +
        "VALUES ($1,$2,$3,EXTRACT(MONTH FROM now() AT TIME ZONE 'Asia/Manila')," +
        "EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Manila'),$4,$5) RETURNING *",
        [description || category,decimal,category,req.actor.id,notes || null]));
    });
    res.status(201).json({success:true,message:"Expense recorded",data:expense(result)});
  }));

  app.delete("/api/moderator/expenses/:id", ...staff, route(async (req,res) => {
    const result=await query("DELETE FROM public.expenses WHERE id=$1 RETURNING id",[req.params.id]);
    if (!result.rowCount) fail("Expense not found",404);
    res.json({success:true,message:"Expense deleted"});
  }));
}

module.exports = { installFinance, balance };
