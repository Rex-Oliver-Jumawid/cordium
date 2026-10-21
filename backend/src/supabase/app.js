"use strict";
require("dotenv").config();
const express=require("express");
const path=require("node:path");
const { installAuth, protect, roles }=require("./auth");
const { installCore }=require("./core");
const { installFinance }=require("./finance");
const { installAdmin }=require("./admin");
const { query }=require("./db");

const app=express();
app.disable("x-powered-by");
app.use(express.json({limit:"1mb"}));
app.use((_req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options","DENY");
  next();
});

app.get("/api/health",async (_req,res)=>{
  try {
    await query("SELECT 1");
    res.json({status:"OK",database:"connected"});
  } catch (_error) {
    res.status(503).json({status:"unavailable",database:"not connected"});
  }
});

installAuth(app);
installCore(app,protect,roles);
installFinance(app,protect,roles);
installAdmin(app,protect,roles);

// Member records have permanent QR codes, but only staff accounts sign in.
// There is no public member self-registration or session generation endpoint.
app.post("/api/user/qr/generate",protect,(_req,res)=>res.status(410).json({
  success:false,message:"Permanent QR codes are issued by moderators. Contact a moderator.",
}));
app.get("/api/user/attendance/history",protect,async (req,res,next)=>{
  try {
    const rows=(await query("SELECT * FROM public.attendance_records WHERE user_id=$1 " +
      "ORDER BY scanned_at DESC LIMIT 100",[req.actor.id])).rows;
    res.json({success:true,records:rows.map((r)=>({
      _id:r.id,scannedAt:r.scanned_at,massType:r.mass_type,notes:r.notes,
    })),total:rows.length,page:1,limit:100,totalPages:1});
  } catch(error) {next(error);}
});
app.get("/api/user/attendance/stats",protect,async (req,res,next)=>{
  try {
    const r=(await query("SELECT COUNT(*)::int AS total FROM public.attendance_records " +
      "WHERE user_id=$1",[req.actor.id])).rows[0];
    res.json({success:true,stats:{totalAttendance:r.total,thisMonthAttendance:0,
      lastMassDate:null,byMassType:{}}});
  }catch(error){next(error);}
});

// Serverless/CDN deployments serve public assets natively.
// Local development serves only the known frontend folders.
if(!process.env.VERCEL) {
  const root=path.resolve(__dirname,"../../..");
  for (const folder of ["html","css","js","images","favicon"]) {
    app.use("/"+folder,express.static(path.join(root,folder),{dotfiles:"deny"}));
  }
}
app.get("/",(_req,res)=>res.redirect(302,"/html/login.html"));
app.use("/api",(_req,res)=>res.status(404).json({success:false,message:"API route not found"}));
app.use((err,_req,res,_next)=>{
  if (err.status) return res.status(err.status).json({success:false,message:err.message});
  if (err.code==="23505") return res.status(409).json({
    success:false,message:"A record already exists for this member or schedule"});
  if (err.code==="23503"||err.code==="23514"||err.code==="22P02")
    return res.status(400).json({success:false,message:"Invalid or referenced data"});
  console.error("Cordium API error:",err.message);
  res.status(500).json({success:false,message:"Unable to complete request"});
});
module.exports=app;
