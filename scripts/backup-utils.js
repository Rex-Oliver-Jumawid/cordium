"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const readline = require("node:readline");
const { createReadStream } = require("node:fs");

const MAGIC = Buffer.from("CRDMBK01", "ascii");
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_SIZE = MAGIC.length + SALT_LENGTH + IV_LENGTH;

function passphrase() {
  const phrase = process.env.CORDIUM_BACKUP_PASSPHRASE;
  if (!phrase || phrase.length < 16) {
    throw new Error("Set CORDIUM_BACKUP_PASSPHRASE (at least 16 characters).");
  }
  return phrase;
}

function encryptStream(salt, iv) {
  const key = crypto.scryptSync(passphrase(), salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const { Transform } = require("node:stream");
  return new Transform({
    transform(chunk, _encoding, done) {
      try { done(null, cipher.update(chunk)); } catch (error) { done(error); }
    },
    flush(done) {
      try {
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        done();
      } catch (error) { done(error); }
    },
  });
}

async function* readEncrypted(archivePath) {
  const stat = fs.statSync(archivePath);
  if (stat.size <= HEADER_SIZE + TAG_LENGTH) throw new Error("Incomplete encrypted backup.");
  const file = fs.openSync(archivePath, "r");
  const header = Buffer.alloc(HEADER_SIZE);
  const tag = Buffer.alloc(TAG_LENGTH);
  try {
    fs.readSync(file, header, 0, HEADER_SIZE, 0);
    fs.readSync(file, tag, 0, TAG_LENGTH, stat.size - TAG_LENGTH);
  } finally {
    fs.closeSync(file);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a Cordium encrypted backup.");
  }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LENGTH);
  const iv = header.subarray(MAGIC.length + SALT_LENGTH);
  const key = crypto.scryptSync(passphrase(), salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const input = createReadStream(archivePath, {
    start: HEADER_SIZE,
    end: stat.size - TAG_LENGTH - 1,
  });
  const gunzip = zlib.createGunzip();
  input.on("error", (error) => gunzip.destroy(error));
  decipher.on("error", (error) => gunzip.destroy(error));
  const lines = readline.createInterface({
    input: input.pipe(decipher).pipe(gunzip),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    yield JSON.parse(line);
  }
}

module.exports = { MAGIC, HEADER_SIZE, passphrase, encryptStream, readEncrypted };
