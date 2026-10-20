"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");

test("schema has all seven protected tables and no password storage",()=>{
 const sql=fs.readFileSync(path.join(root,"supabase/schema.sql"),"utf8");
 assert.equal((sql.match(/CREATE TABLE public\./g)||[]).length,7);
 assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,7);
 assert.match(sql,/REVOKE ALL ON TABLE/);
 assert.doesNotMatch(sql,/email_password|password_hash|legacy_password/i);
 assert.match(sql,/attendance_records_schedule_daily_unique/);
});

test("only whitelisted frontend assets are served",()=>{
 const code=fs.readFileSync(path.join(root,"backend/src/supabase/app.js"),"utf8");
 assert.match(code,/"html","css","js","images","favicon"/);
 assert.doesNotMatch(code,/express\.static\(root\)/);
 const js=fs.readFileSync(path.join(root,"backend/create-admin.js"),"utf8");
 assert.match(js,/process\.env\.ADMIN_PASSWORD/);
 assert.doesNotMatch(js,/password:\s*["'][^"']+/);
});

test("Vercel build output excludes backend and migration backups",()=>{
 const publicDir=path.join(root,"public");
 if(!fs.existsSync(publicDir))return;
 for(const name of ["html","css","js","images","favicon"])
   assert.equal(fs.existsSync(path.join(publicDir,name)),true,name+" missing");
 assert.equal(fs.existsSync(path.join(publicDir,"backend")),false);
 assert.equal(fs.existsSync(path.join(publicDir,"scripts")),false);
});

test("password reset page avoids credential URLs in history",()=>{
 const page=fs.readFileSync(path.join(root,"html/reset-password.html"),"utf8");
 assert.match(page,/history\.replaceState/);
 assert.match(page,/\/api\/auth\/set-password/);
});
