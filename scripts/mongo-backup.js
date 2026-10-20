"use strict";
// READ-ONLY MongoDB export. Creates authenticated, encrypted gzip JSONL.
// MongoDB writes must be paused: collection scans are not one atomic snapshot.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { PassThrough } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const { MongoClient } = require("mongodb");
const { EJSON } = require("bson");
const { MAGIC, passphrase, encryptStream, readEncrypted } = require("./backup-utils");

const COLLECTIONS = [
  "users", "massschedules", "attendancesessions", "attendancerecords",
  "moderatorassignments", "contributions", "expenses",
];

async function main() {
  passphrase();
  const targetArg = process.argv.find((a) => a.startsWith("--out="));
  if (!targetArg) throw new Error("Usage: node scripts/mongo-backup.js --out=/private/path/cordium.backup.enc");
  const target = path.resolve(targetArg.slice("--out=".length));
  if (fs.existsSync(target)) throw new Error("Refusing to overwrite an existing backup.");
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI privately in the local environment.");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = target + ".partial-" + process.pid;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const source = new PassThrough();
  const output = fs.createWriteStream(temp, { flags: "wx", mode: 0o600 });
  output.write(Buffer.concat([MAGIC, salt, iv]));
  // Consume pipeline failure on cleanup.
  const writePromise = pipeline(source, zlib.createGzip(), encryptStream(salt, iv), output);
  const client = new MongoClient(process.env.MONGODB_URI, {
    appName: "cordium-readonly-backup",
    readPreference: "primary",
  });
  let success = false;
  try {
    await client.connect();
    const db = client.db();
    const available = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name));
    if (!available.has("users")) {
      throw new Error("Missing source users collection; check the MongoDB database name.");
    }
    const missing = COLLECTIONS.filter((name) => !available.has(name));
    if (missing.length) {
      console.warn("Absent collections (treated as empty): " + missing.join(", "));
    }
    const counts = {};
    const write = async (value) => {
      if (!source.write(JSON.stringify(value) + "\n")) await once(source, "drain");
    };
    await write({ type: "header", version: 1, database: db.databaseName, createdAt: new Date().toISOString() });
    for (const name of COLLECTIONS) {
      counts[name] = 0;
      if (!available.has(name)) continue;
      const cursor = db.collection(name).find({}, { batchSize: 200 });
      for await (const doc of cursor) {
        await write({ type: "doc", collection: name, data: EJSON.serialize(doc, { relaxed: false }) });
        counts[name] += 1;
      }
    }
    await write({ type: "manifest", counts, completedAt: new Date().toISOString() });
    source.end();
    await writePromise;
    const verifiedCounts = Object.fromEntries(COLLECTIONS.map((name) => [name, 0]));
    let manifest = null;
    for await (const entry of readEncrypted(temp)) {
      if (entry.type === "doc") verifiedCounts[entry.collection]++;
      if (entry.type === "manifest") manifest = entry;
    }
    if (!manifest || JSON.stringify(manifest.counts) !== JSON.stringify(verifiedCounts)) {
      throw new Error("Encrypted archive verification failed.");
    }
    fs.renameSync(temp, target);
    success = true;
    const sha = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(target)) sha.update(chunk);
    console.log(JSON.stringify({
      archive: target,
      sha256: sha.digest("hex"),
      counts,
      note: "Keep archive and passphrase separately. Never commit either to Git.",
    }, null, 2));
  } finally {
    await client.close().catch(() => {});
    if (!success) {
      source.destroy();
      output.destroy();
      await writePromise.catch(() => {});
      try { fs.unlinkSync(temp); } catch (_) {}
    }
  }
}

main().catch((error) => {
  console.error("Backup failed:", error.message);
  process.exitCode = 1;
});
