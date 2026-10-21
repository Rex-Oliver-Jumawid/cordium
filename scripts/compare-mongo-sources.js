"use strict";
// Strict read-only comparison of Atlas and local MongoDB Cordium sources.
// No document values or database credentials are printed.
const crypto = require("node:crypto");
const { MongoClient } = require("mongodb");
const { EJSON } = require("bson");

const COLLECTIONS = [
  "users", "massschedules", "attendancesessions", "attendancerecords",
  "moderatorassignments", "contributions", "expenses",
];
const DATE_FIELDS = ["updatedAt", "createdAt", "scannedAt", "date", "generatedAt", "assignedAt"];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function summaryHash(doc) {
  return JSON.stringify(canonical(EJSON.serialize(doc, { relaxed: false })));
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function recentDate(doc) {
  let latest = null;
  for (const field of DATE_FIELDS) {
    const value = safeDate(doc[field]);
    if (value && (!latest || value > latest)) latest = value;
  }
  return latest;
}

async function scan(label, uri, dbName) {
  if (!uri || !dbName) throw new Error("Missing " + label + " URI or database name.");
  if (typeof dbName !== "string" || !/^[a-zA-Z0-9_\-]+$/.test(dbName)) {
    throw new Error("Invalid explicit " + label + " database name.");
  }
  const client = new MongoClient(uri, {
    appName: "cordium-readonly-source-compare",
    serverSelectionTimeoutMS: 12000,
    readPreference: "primary",
    retryWrites: false,
  });
  try {
    await client.connect();
    const db = client.db(dbName);
    const available = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    if (!available.has("users")) throw new Error("No users collection found in " + label + ". Check the database name.");
    const summary = {};
    for (const name of COLLECTIONS) {
      if (!available.has(name)) {
        summary[name] = { count: 0, sha256: null, latestActivity: null, absent: true };
        continue;
      }
      const hash = crypto.createHash("sha256");
      let count = 0;
      let latest = null;
      // Stable ObjectId order ensures comparisons are independent of natural document order.
      const cursor = db.collection(name).find({}, { batchSize: 200 }).sort({ _id: 1 });
      for await (const doc of cursor) {
        hash.update(summaryHash(doc) + "\n");
        const activity = recentDate(doc);
        if (activity && (!latest || activity > latest)) latest = activity;
        count++;
      }
      summary[name] = { count, sha256: hash.digest("hex"), latestActivity: latest, absent: false };
    }
    return summary;
  } finally {
    await client.close().catch(() => {});
  }
}

function compare(atlas, local) {
  return COLLECTIONS.map((collection) => {
    const a = atlas[collection];
    const b = local[collection];
    const equal = a.count === b.count &&
      (a.count === 0 || a.sha256 === b.sha256);
    return {
      collection, atlasCount: a.count, localCount: b.count,
      identical: equal, atlasLatestActivity: a.latestActivity,
      localLatestActivity: b.latestActivity,
    };
  });
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("Usage: node scripts/compare-mongo-sources.js (set connection environment variables)");
  }
  const atlas = await scan("Atlas", process.env.CORDIUM_ATLAS_URI, process.env.CORDIUM_ATLAS_DB);
  const local = await scan("Local", process.env.CORDIUM_LOCAL_URI, process.env.CORDIUM_LOCAL_DB);
  const report = compare(atlas, local);
  console.log(JSON.stringify({
    status: report.every((item) => item.identical) ? "identical_at_read_time" : "sources_differ",
    records: report,
    notice: "Read-only comparison, not an atomic snapshot. Back up BOTH databases before importing either.",
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    // Database drivers can embed host/URI details. Print only a short safe failure.
    const message = /Missing|Invalid explicit|No users collection|Usage:/.test(error.message)
      ? error.message : "Connection/read failed. Check URI, database name, Atlas IP access and local MongoDB service.";
    console.error(message);
    process.exitCode = 1;
  });
}
module.exports = { canonical, summaryHash, recentDate, compare, COLLECTIONS };
