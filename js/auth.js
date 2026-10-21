// Authentication Manager

class AuthManager {
  constructor() {
    this.token = null;
    this.user = null;
    this.loadFromStorage();
  }

  // Load auth data from localStorage
  loadFromStorage() {
    this.token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    const userData = localStorage.getItem(STORAGE_KEYS.USER);
    if (userData) {
      this.user = JSON.parse(userData);
    }
  }

  // Save auth data to localStorage
  saveToStorage(token, user, refreshToken) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    if (refreshToken) localStorage.setItem(STORAGE_KEYS.REFRESH, refreshToken);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEYS.ROLE, user.role);
    this.token = token;
    this.user = user;
  }

  // Clear auth data
  clearStorage() {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.ROLE);
    this.token = null;
    this.user = null;
  }

  // Check if user is logged in
  isLoggedIn() {
    return !!this.token;
  }

  // Get current user
  getCurrentUser() {
    return this.user;
  }

  // Get user role
  getUserRole() {
    return this.user?.role || null;
  }

  // Check if user has specific role
  hasRole(role) {
    return this.user?.role === role;
  }

  // Register new user
  async register(userData) {
    try {
      const response = await api.register(userData);
      if (response.success) {
        this.saveToStorage(response.token, response.user, response.refreshToken);
        return response;
      }
      throw new Error(response.message);
    } catch (error) {
      throw error;
    }
  }

  // Login
  async login(email, password) {
    try {
      const response = await api.login(email, password);
      if (response.success) {
        this.saveToStorage(response.token, response.user, response.refreshToken);
        return response;
      }
      throw new Error(response.message);
    } catch (error) {
      throw error;
    }
  }

  // Logout
  async logout() {
    try {
      if (this.isLoggedIn()) {
        await api.logout();
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      this.clearStorage();
      window.location.href = "/html/login.html";
    }
  }

  // Redirect based on role
  redirectToDashboard() {
    const role = this.getUserRole();
    switch (role) {
      case "admin":
        window.location.href = "/html/admin/admin.html";
        break;
      case "moderator":
        window.location.href = "/html/moderator/moderator.html";
        break;
      case "user":
        window.location.href = "/html/user/user.html";
        break;
      default:
        window.location.href = "/html/login.html";
    }
  }

  // Protect page (redirect if not logged in)
  protectPage(requiredRole = null) {
    if (!this.isLoggedIn()) {
      window.location.href = "/html/login.html";
      return false;
    }

    if (requiredRole && !this.hasRole(requiredRole)) {
      alert("You do not have permission to access this page");
      this.redirectToDashboard();
      return false;
    }

    return true;
  }

  // Check authentication and get user data
  async checkAuth() {
    if (!this.isLoggedIn()) {
      return false;
    }

    try {
      const response = await api.getMe();
      this.token = localStorage.getItem(STORAGE_KEYS.TOKEN);
      if (response.success) {
        // Update user data
        this.user = response.user;
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.user));
        return true;
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      this.clearStorage();
    }

    return false;
  }
}

// Create global auth instance
const auth = new AuthManager();
