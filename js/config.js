const API_CONFIG = {
  BASE_URL: `${window.location.protocol}//${window.location.host}/api`,
  ENDPOINTS: {
    // Auth endpoints
    REGISTER: "/auth/register",
    LOGIN: "/auth/login",
    LOGOUT: "/auth/logout",
    GET_ME: "/auth/me",

    // User endpoints
    GENERATE_QR: "/user/qr/generate",
    QR_STATUS: "/user/qr/status",
    USER_ATTENDANCE_HISTORY: "/user/attendance/history",
    USER_ATTENDANCE_STATS: "/user/attendance/stats",

    // Moderator endpoints
    SCAN_QR: "/moderator/scan",
    MODERATOR_RECENT_SCANS: "/moderator/attendance/recent",
    MODERATOR_ACTIVE_SESSIONS: "/moderator/sessions/active",
    MODERATOR_STATS: "/moderator/stats",
    MODERATOR_REGISTER_USER: "/moderator/users/register",
    MODERATOR_GET_USERS: "/moderator/users",
    MODERATOR_UPDATE_USER_STATUS: "/moderator/users/:id/status",
    MODERATOR_CONTRIBUTIONS: "/moderator/contributions",
    MODERATOR_EXPENSES: "/moderator/expenses",
    MODERATOR_SCHEDULE_ATTENDEES: "/moderator/schedules/:scheduleId/attendees",

    // Admin endpoints
    ADMIN_USERS: "/admin/users",
    ADMIN_USER_BY_ID: "/admin/users",
    ADMIN_UPDATE_USER_STATUS: "/admin/users",
    ADMIN_MODERATORS: "/admin/moderators",
    ADMIN_CREATE_MODERATOR: "/admin/moderators/create",
    ADMIN_ASSIGN_MODERATOR: "/admin/moderators/assign",
    ADMIN_REMOVE_MODERATOR: "/admin/moderators",
    ADMIN_REPORTS: "/admin/reports",
    ADMIN_STATS: "/admin/stats",
    ADMIN_MASS_SCHEDULES: "/admin/mass-schedules",
    MASS_SCHEDULES: "/mass-schedules",
    ADMIN_ATTENDANCE_REPORTS: "/admin/reports/attendance",

    // Mass Schedule endpoints (public current schedule)
    CURRENT_SCHEDULE: "/mass-schedules/current",
  },
};

// Local Storage Keys
const STORAGE_KEYS = {
  TOKEN: "auth_token",
  REFRESH: "auth_refresh_token",
  USER: "user_data",
  ROLE: "user_role",
};

// Mass Types for church attendance
const MASS_TYPES = ["Sunday Mass", "Weekday Mass", "Special Mass", "Other"];

// Days of week
const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];
