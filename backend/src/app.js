const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const frontendRoot = path.resolve(__dirname, "../..");

app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const moderatorRoutes = require("./routes/moderator.routes");
const userRoutes = require("./routes/user.routes");
const massScheduleRoutes = require("./routes/massSchedule.routes");

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/moderator", moderatorRoutes);
app.use("/api/user", userRoutes);
app.use("/api/mass-schedules", massScheduleRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "OK",
    message: "Church Attendance System API is running",
    timestamp: new Date(),
  });
});

// Only expose client assets, never the backend folder or repository files.
for (const directory of ["html", "css", "js", "images", "favicon"]) {
  app.use(
    "/" + directory,
    express.static(path.join(frontendRoot, directory), { dotfiles: "deny" })
  );
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendRoot, "html/login.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

module.exports = app;
