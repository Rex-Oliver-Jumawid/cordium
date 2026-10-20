"use strict";
const { createClient } = require("@supabase/supabase-js");
const { query, user, first, route, fail } = require("./db");

function authClient(key = process.env.SUPABASE_PUBLISHABLE_KEY) {
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
  }
  return createClient(process.env.SUPABASE_URL, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function tokenFrom(req) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || "");
  return match ? match[1] : null;
}

async function linkedUser(authId) {
  return first(await query("SELECT * FROM public.users WHERE auth_user_id = $1", [authId]));
}

async function protect(req, res, next) {
  try {
    const token = tokenFrom(req);
    if (!token) return res.status(401).json({ success: false, message: "Login required" });
    // getUser validates the supplied token with Supabase Auth. Do not rely
    // on a decoded JWT or browser-submitted role.
    const { data, error } = await authClient().auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }
    const actor = await linkedUser(data.user.id);
    if (!actor || !actor.is_active || actor.email !== data.user.email?.toLowerCase()) {
      return res.status(403).json({ success: false, message: "Account not linked or inactive" });
    }
    req.actor = actor;
    req.authUser = data.user;
    req.accessToken = token;
    next();
  } catch (error) { next(error); }
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!req.actor || !allowed.includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: "Permission denied" });
    }
    next();
  };
}

async function finishLogin(session, authUser, res) {
  if (!session || !authUser) fail("Invalid credentials", 401);
  const actor = await linkedUser(authUser.id);
  if (!actor || !actor.is_active || actor.email !== authUser.email?.toLowerCase() ||
      !["moderator", "admin"].includes(actor.role)) {
    return res.status(403).json({
      success: false, message: "This account is not linked to an active Cordium staff profile",
    });
  }
  return res.json({
    success: true, message: "Login successful",
    token: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    user: user(actor),
  });
}

function installAuth(app) {
  app.post("/api/auth/login", route(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string") fail("Email and password are required");
    const { data, error } = await authClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (error) return res.status(401).json({ success: false, message: "Invalid credentials" });
    return finishLogin(data.session, data.user, res);
  }));

  app.post("/api/auth/refresh", route(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (typeof refreshToken !== "string" || !refreshToken) fail("Refresh token missing", 401);
    const { data, error } = await authClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) return res.status(401).json({ success: false, message: "Please log in again" });
    return finishLogin(data.session, data.user, res);
  }));

  app.get("/api/auth/me", protect, (_req, res) => {
    return res.json({ success: true, user: user(_req.actor) });
  });

  app.post("/api/auth/logout", protect, route(async (req, res) => {
    // Admin API can revoke a single session's refresh token. Access JWTs
    // remain valid until expiry under Supabase Auth's normal semantics.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { error } = await authClient(process.env.SUPABASE_SERVICE_ROLE_KEY)
        .auth.admin.signOut(req.accessToken, "local");
      if (error) throw error;
    }
    res.json({ success: true, message: "Logged out" });
  }));

  app.post("/api/auth/recover", route(async (req, res) => {
    const { email } = req.body || {};
    if (typeof email !== "string" || !email.includes("@")) fail("Valid email required");
    const base = process.env.FRONTEND_URL;
    if (!base || !/^https:\/\//.test(base)) {
      fail("Password recovery is not configured", 503);
    }
    const redirectTo = new URL("/html/reset-password.html", base).toString();
    // Do not reveal whether the email is registered.
    await authClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    return res.json({ success: true, message: "If eligible, instructions will be emailed" });
  }));

  app.post("/api/auth/set-password", route(async (req, res) => {
    const { accessToken, refreshToken, password } = req.body || {};
    if (typeof accessToken !== "string" || typeof refreshToken !== "string" ||
        typeof password !== "string" || password.length < 12 || password.length > 128) {
      fail("Valid session tokens and a password of 12-128 characters are required");
    }
    const client = authClient();
    const { error: sessionError } = await client.auth.setSession({
      access_token: accessToken, refresh_token: refreshToken,
    });
    if (sessionError) fail("Expired or invalid invitation", 401);
    const { error } = await client.auth.updateUser({ password });
    if (error) fail("Unable to update password", 400);
    return res.json({ success: true, message: "Password set. You can log in." });
  }));
}

module.exports = { installAuth, protect, roles, authClient, linkedUser };
