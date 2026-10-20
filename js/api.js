// API Helper - Makes HTTP requests to backend

class API {
  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
  }

  // Get auth token from localStorage
  getToken() {
    return localStorage.getItem(STORAGE_KEYS.TOKEN);
  }

  // Set auth headers
  getHeaders(includeAuth = true) {
    const headers = {
      "Content-Type": "application/json",
    };

    if (includeAuth) {
      const token = this.getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  // Refresh a staff access token once when Supabase reports an expired JWT.
  async refreshSession() {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH);
    if (!refreshToken) throw new Error("Please log in again");
    if (!this.pendingRefresh) {
      this.pendingRefresh = (async () => {
        const response = await fetch(this.baseURL + "/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.token) {
          throw new Error("Session expired. Please log in again.");
        }
        localStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
        localStorage.setItem(STORAGE_KEYS.REFRESH, data.refreshToken);
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
        localStorage.setItem(STORAGE_KEYS.ROLE, data.user.role);
        return data;
      })().finally(() => { this.pendingRefresh = null; });
    }
    return this.pendingRefresh;
  }

  // Generic request method
  async request(endpoint, options = {}) {
    const includeAuth = options.auth !== false;
    const { auth: _authOption, ...fetchOptions } = options;
    const send = () => fetch(this.baseURL + endpoint, {
      ...fetchOptions,
      headers: { ...this.getHeaders(includeAuth), ...(fetchOptions.headers || {}) },
    });
    let response;
    try {
      response = await send();
      if (response.status === 401 && includeAuth && endpoint !== "/auth/logout") {
        try {
          await this.refreshSession();
          response = await send();
        } catch (error) {
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          localStorage.removeItem(STORAGE_KEYS.REFRESH);
          throw error;
        }
      }
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || "Request failed");
        error.data = data;
        error.session = data.session;
        throw error;
      }
      return data;
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }

  // GET request
  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      method: "GET",
      ...options,
    });
  }

  // POST request
  async post(endpoint, body, options = {}) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      ...options,
    });
  }

  // PUT request
  async put(endpoint, body, options = {}) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
      ...options,
    });
  }

  // DELETE request
  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      method: "DELETE",
      ...options,
    });
  }

  // PATCH request
  async patch(endpoint, body, options = {}) {
    return this.request(endpoint, {
      method: "PATCH",
      body: JSON.stringify(body),
      ...options,
    });
  }

  // ========== AUTH APIS ==========
  async register(userData) {
    return this.post(API_CONFIG.ENDPOINTS.REGISTER, userData, { auth: false });
  }

  async login(email, password) {
    return this.post(
      API_CONFIG.ENDPOINTS.LOGIN,
      { email, password },
      { auth: false },
    );
  }

  async logout() {
    return this.post(API_CONFIG.ENDPOINTS.LOGOUT);
  }

  async getMe() {
    return this.get(API_CONFIG.ENDPOINTS.GET_ME);
  }

  // ========== USER APIS ==========
  async generateQR() {
    return this.post(API_CONFIG.ENDPOINTS.GENERATE_QR);
  }

  async getQRStatus(sessionId) {
    return this.get(`${API_CONFIG.ENDPOINTS.QR_STATUS}/${sessionId}`);
  }

  async getUserAttendanceHistory(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(
      `${API_CONFIG.ENDPOINTS.USER_ATTENDANCE_HISTORY}?${queryString}`,
    );
  }

  async getUserAttendanceStats(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(
      `${API_CONFIG.ENDPOINTS.USER_ATTENDANCE_STATS}?${queryString}`,
    );
  }

  // ========== MODERATOR APIS ==========
  async scanQR(data) {
    return this.post(API_CONFIG.ENDPOINTS.SCAN_QR, data);
  }

  async getModeratorRecentScans(limit = 20, dateRange = "day") {
    return this.get(
      `${API_CONFIG.ENDPOINTS.MODERATOR_RECENT_SCANS}?limit=${limit}&range=${dateRange}`,
    );
  }
  async getActiveSessions() {
    return this.get(API_CONFIG.ENDPOINTS.MODERATOR_ACTIVE_SESSIONS);
  }

  async getModeratorStats(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`${API_CONFIG.ENDPOINTS.MODERATOR_STATS}?${queryString}`);
  }

  async registerUser(userData) {
    return this.post(API_CONFIG.ENDPOINTS.MODERATOR_REGISTER_USER, userData);
  }

  async getAllUsersForModerator() {
    return this.get(API_CONFIG.ENDPOINTS.MODERATOR_GET_USERS);
  }

  async updateUserStatusAsModerator(userId, isActive) {
    return this.patch(
      API_CONFIG.ENDPOINTS.MODERATOR_UPDATE_USER_STATUS.replace(":id", userId),
      { isActive },
    );
  }

  async getScheduleAttendees(scheduleId) {
    return this.get(
      API_CONFIG.ENDPOINTS.MODERATOR_SCHEDULE_ATTENDEES.replace(
        ":scheduleId",
        scheduleId,
      ),
    );
  }

  async addContribution(contributionData) {
    return this.post(
      API_CONFIG.ENDPOINTS.MODERATOR_CONTRIBUTIONS,
      contributionData,
    );
  }

  async getAllContributions() {
    return this.get(API_CONFIG.ENDPOINTS.MODERATOR_CONTRIBUTIONS);
  }

  async addExpense(expenseData) {
    return this.post(API_CONFIG.ENDPOINTS.MODERATOR_EXPENSES, expenseData);
  }

  async getAllExpenses() {
    return this.get(API_CONFIG.ENDPOINTS.MODERATOR_EXPENSES);
  }

  async deleteExpense(id) {
    return this.delete(`/moderator/expenses/${id}`);
  }

  async getAvailableBalance() {
    return this.get("/moderator/balance");
  }

  // ========== ADMIN APIS ==========
  async getAllUsers(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`${API_CONFIG.ENDPOINTS.ADMIN_USERS}?${queryString}`);
  }

  async getUserById(userId) {
    return this.get(`${API_CONFIG.ENDPOINTS.ADMIN_USER_BY_ID}/${userId}`);
  }

  async updateUserStatus(userId, isActive) {
    return this.put(
      `${API_CONFIG.ENDPOINTS.ADMIN_UPDATE_USER_STATUS}/${userId}/status`,
      { isActive },
    );
  }

  async getAllModerators() {
    return this.get(API_CONFIG.ENDPOINTS.ADMIN_MODERATORS);
  }

  async createModerator(moderatorData) {
    return this.post(
      API_CONFIG.ENDPOINTS.ADMIN_CREATE_MODERATOR,
      moderatorData,
    );
  }

  async assignModerator(userId, username, password) {
    return this.post(API_CONFIG.ENDPOINTS.ADMIN_ASSIGN_MODERATOR, {
      userId,
      username,
      password,
    });
  }

  async removeModerator(userId) {
    return this.delete(
      `${API_CONFIG.ENDPOINTS.ADMIN_REMOVE_MODERATOR}/${userId}`,
    );
  }

  async deleteUser(userId) {
    return this.delete(`${API_CONFIG.ENDPOINTS.ADMIN_USERS}/${userId}`);
  }

  async updateContribution(contributionId, data) {
    return this.put(
      `${API_CONFIG.ENDPOINTS.MODERATOR_CONTRIBUTIONS}/${contributionId}`,
      data,
    );
  }

  async generateReport(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`${API_CONFIG.ENDPOINTS.ADMIN_REPORTS}?${queryString}`);
  }

  async getSystemStats() {
    return this.get(API_CONFIG.ENDPOINTS.ADMIN_STATS);
  }

  async updateEmailPassword(emailPassword) {
    return this.put("/admin/email-config", { emailPassword });
  }

  async sendAbsenceFollowUp(scheduleId) {
    return this.post(
      `/admin/mass-schedules/${scheduleId}/send-absence-followup`,
    );
  }

  async getAdminAttendanceReports(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(
      `${API_CONFIG.ENDPOINTS.ADMIN_ATTENDANCE_REPORTS}?${queryString}`,
    );
  }

  async deleteAttendanceRecord(recordId) {
    return this.delete(`/admin/attendance/${recordId}`);
  }

  // ========== MASS SCHEDULE APIS ==========
  async getMassSchedules(active) {
    const query = active !== undefined ? `?active=${active}` : "";
    return this.get(`${API_CONFIG.ENDPOINTS.MASS_SCHEDULES}${query}`);
  }

  async getCurrentSchedule() {
    return this.get(API_CONFIG.ENDPOINTS.CURRENT_SCHEDULE, { auth: false });
  }

  async createMassSchedule(scheduleData) {
    return this.post(API_CONFIG.ENDPOINTS.MASS_SCHEDULES, scheduleData);
  }

  async updateMassSchedule(scheduleId, scheduleData) {
    return this.put(
      `${API_CONFIG.ENDPOINTS.MASS_SCHEDULES}/${scheduleId}`,
      scheduleData,
    );
  }

  async deleteMassSchedule(scheduleId) {
    return this.delete(`${API_CONFIG.ENDPOINTS.MASS_SCHEDULES}/${scheduleId}`);
  }

  // Add after the getSystemStats method:

  async getMassSchedules(active) {
    const query = active !== undefined ? `?active=${active}` : "";
    return this.get(`${API_CONFIG.ENDPOINTS.MASS_SCHEDULES}${query}`);
  }

  async getCurrentSchedule() {
    return this.get(API_CONFIG.ENDPOINTS.CURRENT_SCHEDULE, { auth: false });
  }

  async createMassSchedule(scheduleData) {
    return this.post(API_CONFIG.ENDPOINTS.ADMIN_MASS_SCHEDULES, scheduleData);
  }

  async updateMassSchedule(scheduleId, scheduleData) {
    return this.put(
      `${API_CONFIG.ENDPOINTS.ADMIN_MASS_SCHEDULES}/${scheduleId}`,
      scheduleData,
    );
  }

  async deleteMassSchedule(scheduleId) {
    return this.delete(
      `${API_CONFIG.ENDPOINTS.ADMIN_MASS_SCHEDULES}/${scheduleId}`,
    );
  }
}

// Create global API instance
const api = new API();
