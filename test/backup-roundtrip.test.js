"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
const zlib=require("node:zlib");
const { Readable }=require("node:stream");
const { pipeline }=require("node:stream/promises");
const { ObjectId }=require("mongodb");
const { EJSON }=require("bson");
const { MAGIC,encryptStream,readEncrypted }=require("../scripts/backup-utils");
const { readPlan }=require("../scripts/mongo-import");
process.env.CORDIUM_BACKUP_PASSPHRASE="test-only-fake-passphrase-for-fixtures";

const ADMIN=new ObjectId("507f1f77bcf86cd799439011");
const MEMBER=new ObjectId("507f1f77bcf86cd799439012");
const SCHED=new ObjectId("507f1f77bcf86cd799439013");
const SCAN=new ObjectId("507f1f77bcf86cd799439014");
const SCAN2=new ObjectId("507f1f77bcf86cd799439015");
const DOCS={
  users:[
    {_id:ADMIN,email:"admin@example.org",role:"admin",firstName:"Admin",lastName:"Person"},
    {_id:MEMBER,email:"member@example.org",role:"member",firstName:"Member",lastName:"Person",
      qrCode:"f".repeat(64)},
  ],
  massschedules:[{_id:SCHED,name:"Sunday Service",massType:"Sunday Mass",
    scheduleType:"recurring",dayOfWeek:[0],startTime:"08:00",endTime:"09:00",createdBy:ADMIN}],
  attendancesessions:[],
  attendancerecords:[{_id:SCAN,userId:MEMBER,moderatorId:ADMIN,scheduleId:SCHED,
    massType:"Sunday Mass",scannedAt:new Date("2026-10-18T01:00:00Z")}],
  moderatorassignments:[],
  contributions:[{_id:new ObjectId("507f1f77bcf86cd799439016"),
    userId:MEMBER,scheduleId:SCHED,recordedBy:ADMIN,amount:120.50}],
  expenses:[{_id:new ObjectId("507f1f77bcf86cd799439017"),
    description:"Supplies",amount:20,category:"Supplies",month:10,year:2026,recordedBy:ADMIN}],
};
async function archive(data) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"cordium-fixture-"));
  const archivePath=path.join(base,"sample.backup.enc");
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
  const output=fs.createWriteStream(archivePath,{mode:0o600});
  output.write(Buffer.concat([MAGIC,salt,iv]));
  const names=Object.keys(data);
  const counts=Object.fromEntries(names.map((name)=>[name,data[name].length]));
  const entries=[{type:"header",version:1,database:"cordium",createdAt:"2026-10-18T01:00:00Z"}];
  for(const name of names)for(const doc of data[name])
    entries.push({type:"doc",collection:name,data:EJSON.serialize(doc,{relaxed:false})});
  entries.push({type:"manifest",counts,completedAt:"2026-10-18T01:00:00Z"});
  await pipeline(Readable.from([entries.map((x)=>JSON.stringify(x)).join("\n")+"\n"]),
    zlib.createGzip(),encryptStream(salt,iv),output);
  return {archivePath,base};
}

test("encrypted backup decrypts and imports all seven relational collections",async(t)=>{
  const fixture=await archive(DOCS);
  t.after(()=>fs.rmSync(fixture.base,{recursive:true,force:true}));
  const decoded=[];
  for await(const x of readEncrypted(fixture.archivePath))decoded.push(x);
  assert.equal(decoded.length,8);
  const {report,records}=await readPlan(fixture.archivePath);
  assert.equal(report.counts.users,2);
  assert.equal(report.totalContributionsPHP,"120.50");
  assert.equal(report.totalExpensesPHP,"20.00");
  assert.equal(report.staffRequiringAuthInvite,1);
  assert.equal(records.attendancerecords[0].attendance_date,"2026-10-18");
});

test("archive tampering fails authenticated decryption",async(t)=>{
  const f=await archive(DOCS);
  t.after(()=>fs.rmSync(f.base,{recursive:true,force:true}));
  const fd=fs.openSync(f.archivePath,"r+");
  const size=fs.statSync(f.archivePath).size;
  const byte=Buffer.alloc(1);
  fs.readSync(fd,byte,0,1,size-1);
  byte[0]^=0xff;
  fs.writeSync(fd,byte,0,1,size-1);
  fs.closeSync(fd);
  await assert.rejects(async()=>{
    for await(const _entry of readEncrypted(f.archivePath)) {}
  });
});

test("preflight rejects duplicate same-day attendance without writing",async(t)=>{
  const docs={...DOCS,attendancerecords:[
    ...DOCS.attendancerecords,
    {...DOCS.attendancerecords[0],_id:SCAN2},
  ]};
  const f=await archive(docs);
  t.after(()=>fs.rmSync(f.base,{recursive:true,force:true}));
  await assert.rejects(()=>readPlan(f.archivePath),/Duplicate attendance/);
});

test("preflight rejects orphaned Mongo references",async(t)=>{
  const docs={...DOCS,attendancerecords:[
    {...DOCS.attendancerecords[0],userId:new ObjectId("507f1f77bcf86cd799439099")},
  ]};
  const f=await archive(docs);
  t.after(()=>fs.rmSync(f.base,{recursive:true,force:true}));
  await assert.rejects(()=>readPlan(f.archivePath),/Orphan/);
});
