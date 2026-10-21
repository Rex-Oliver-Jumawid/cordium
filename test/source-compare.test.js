"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { ObjectId }=require("mongodb");
const { summaryHash, recentDate, compare, COLLECTIONS }=
  require("../scripts/compare-mongo-sources");

test("document fingerprint is independent of field order",()=>{
  const id=new ObjectId("507f1f77bcf86cd799439011");
  const a={_id:id,name:"Ada",meta:{two:2,one:1},email:"example@example.org"};
  const b={email:"example@example.org",meta:{one:1,two:2},name:"Ada",_id:id};
  assert.equal(summaryHash(a),summaryHash(b));
  assert.notEqual(summaryHash(a),summaryHash({...b,name:"Different"}));
});

test("source comparison detects different documents with identical counts",()=>{
  const source=Object.fromEntries(COLLECTIONS.map((n)=>[n,{
    count:0,sha256:null,latestActivity:null,
  }]));
  const atlas={...source,users:{count:3,sha256:"hash1",latestActivity:"2026-10-21T01:00:00.000Z"}};
  const local={...source,users:{count:3,sha256:"hash2",latestActivity:"2026-10-21T02:00:00.000Z"}};
  const report=compare(atlas,local);
  assert.equal(report.find((x)=>x.collection==="users").identical,false);
  assert.equal(report.filter((x)=>!x.identical).length,1);
});

test("source comparison considers same zero-count collections equal",()=>{
  const source=Object.fromEntries(COLLECTIONS.map((n)=>[n,{
    count:0,sha256:null,latestActivity:null,
  }]));
  assert.equal(compare(source,source).every((x)=>x.identical),true);
});

test("latestActivity selects newest valid timestamp without printing records",()=>{
  assert.equal(recentDate({
    updatedAt:new Date("2026-10-20T10:00:00Z"),
    scannedAt:new Date("2026-10-21T10:00:00Z"),
    email:"private@example.org",
  }),"2026-10-21T10:00:00.000Z");
  assert.equal(recentDate({updatedAt:"invalid-date"}),null);
});
