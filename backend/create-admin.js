// Local legacy MongoDB bootstrap only. Do not use for Supabase Auth.
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ADMIN = {
  username: process.env.ADMIN_USERNAME,
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
  firstName: process.env.ADMIN_FIRST_NAME,
  lastName: process.env.ADMIN_LAST_NAME,
  phoneNumber: process.env.ADMIN_PHONE_NUMBER || "",
};

async function createAdmin() {
  const missing = Object.entries(ADMIN)
    .filter(([key, value]) => key !== "phoneNumber" && !value)
    .map(([key]) => key);
  if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
  if (missing.length > 0) {
    throw new Error("Missing required environment values: " + missing.join(", "));
  }
  if (ADMIN.password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = mongoose.connection.db.collection("users");
    const existing = await users.findOne({
      $or: [{ email: ADMIN.email }, { username: ADMIN.username }],
    });
    if (existing) {
      throw new Error("Admin username or email already exists");
    }

    await users.insertOne({
      username: ADMIN.username,
      email: ADMIN.email,
      password: await bcrypt.hash(ADMIN.password, 12),
      role: "admin",
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      phoneNumber: ADMIN.phoneNumber,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    console.log("Admin account created.");
  } finally {
    await mongoose.disconnect();
  }
}

createAdmin().catch((err) => {
  console.error("Admin creation failed:", err.message);
  process.exitCode = 1;
});
