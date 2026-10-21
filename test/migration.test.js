"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { idOf,convert,manilaDay,money }=require("../scripts/mongo-import");
const { validateSchedule,currentSchedule,manilaClock }=require("../backend/src/supabase/core");

const ID="507f1f77bcf86cd799439011";
const ID2="507f1f77bcf86cd799439012";
const at="2026-10-20T12:00:00.000Z";

test("stable source-to-target IDs are UUID-shaped and distinct",()=>{
  const user=idOf("users",ID);
  assert.match(user,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(user,idOf("users",ID));
  assert.notEqual(user,idOf("massschedules",ID));
  assert.notEqual(user,idOf("users",ID2));
  assert.throws(()=>idOf("users","not-an-id"));
});

test("migration drops legacy password and app-password fields",()=>{
  const converted=convert("users",{
    _id:ID,email:"EXAMPLE@EXAMPLE.COM",firstName:"Sample",lastName:"Member",
    role:"admin",password:"private-hash",emailPassword:"private-app-password",
    qrCode:null,createdAt:at,updatedAt:at,
  },at);
  assert.equal(converted.email,"example@example.com");
  assert.equal(converted.auth_user_id,null);
  assert.equal("password" in converted,false);
  assert.equal("emailPassword" in converted,false);
  assert.equal(converted.legacy_mongo_id,ID);
});

test("attendance date respects Manila midnight, not UTC",()=>{
  assert.equal(manilaDay("2026-10-20T17:00:00.000Z"),"2026-10-21");
  assert.equal(manilaClock(new Date("2026-10-20T17:00:00.000Z")).date,"2026-10-21");
  const data=convert("attendancerecords",{
    _id:ID,userId:ID2,moderatorId:ID2,scannedAt:new Date("2026-10-20T17:00:00Z"),
  },at);
  assert.equal(data.attendance_date,"2026-10-21");
});

test("money rejects inaccurate amounts and oversize amounts",()=>{
  assert.equal(money(25.5),"25.50");
  assert.throws(()=>money(-1));
  assert.throws(()=>money(12.345));
  assert.throws(()=>money("n/a"));
  assert.throws(()=>money(10000000000));
});

test("specific and recurring schedules keep frontend contract",()=>{
  assert.throws(()=>validateSchedule({name:"Sunday",massType:"Sunday Mass",
    scheduleType:"recurring",startTime:"09:00",endTime:"10:00",dayOfWeek:[]}));
  const input=validateSchedule({
    name:"Sunday",massType:"Sunday Mass",scheduleType:"recurring",
    startTime:"09:00",endTime:"10:00",dayOfWeek:[0],
  });
  assert.deepEqual(input.day_of_week,[0]);
  const match=currentSchedule([{
    is_active:true,schedule_type:"specific",specific_date:"2026-10-21",
    start_time:"01:00",end_time:"02:00",
  }],new Date("2026-10-20T17:30:00Z"));
  assert.ok(match);
});

test("daily record relation IDs map to expected collections",()=>{
  const doc=convert("attendancerecords",{
    _id:ID,userId:ID2,moderatorId:ID2,
    scheduleId:ID2,sessionId:null,scannedAt:new Date(at),
  },at);
  assert.equal(doc.user_id,idOf("users",ID2));
  assert.equal(doc.schedule_id,idOf("massschedules",ID2));
  assert.equal(doc.session_id,null);
});
