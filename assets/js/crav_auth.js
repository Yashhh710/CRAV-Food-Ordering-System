/**
 * CRAV Client-Side Authentication & Session Helper
 * Manages JWT tokens, user state, prefilling forms, and smart redirects
 */
(function (window) {
  'use strict';

  var TOKEN_KEY = 'crav_auth_token';
  var REFRESH_KEY = 'crav_refresh_token';
  var USER_KEY = 'crav_auth_user';
  var REDIRECT_KEY = 'crav_redirect_after_auth';

  var CravAuth = {
    getToken: function () {
      return localStorage.getItem(TOKEN_KEY);
    },
    getRefreshToken: function () {
      return localStorage.getItem(REFRESH_KEY);
    },
    getUser: function () {
      try {
        var u = localStorage.getItem(USER_KEY);
        return u ? JSON.parse(u) : null;
      } catch (e) {
        return null;
      }
    },
    isLoggedIn: function () {
      return !!(this.getToken() && this.getUser());
    },
    setSession: function (token, refreshToken, user) {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      this.updateHeaderUi();
    },
    clearSession: function () {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
      this.updateHeaderUi();
    },
    logout: function () {
      this.clearSession();
      window.location.href = 'index.html';
    },

    setRedirect: function (url) {
      sessionStorage.setItem(REDIRECT_KEY, url);
    },
    getRedirect: function () {
      return sessionStorage.getItem(REDIRECT_KEY);
    },
    clearRedirect: function () {
      sessionStorage.removeItem(REDIRECT_KEY);
    },

    // API Helpers
    register: function (data) {
      return fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); });
    },

    verifyOtp: function (email, otp) {
      var self = this;
      return fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, otp: otp })
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success && res.token && res.user) {
          self.setSession(res.token, res.refreshToken, res.user);
        }
        return res;
      });
    },

    resendOtp: function (email) {
      return fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function (r) { return r.json(); });
    },

    login: function (email, password) {
      var self = this;
      return fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success && res.token && res.user) {
          self.setSession(res.token, res.refreshToken, res.user);
        }
        return res;
      });
    },

    fetchProfile: function () {
      var token = this.getToken();
      if (!token) return Promise.reject(new Error('No token'));
      return fetch('/api/user/profile', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) { return r.json(); });
    },

    updateHeaderUi: function () {
      var user = this.getUser();
      var userLinks = document.querySelectorAll('.ui-header-tools a[href="signup.html"], .ui-header-tools a[href="login.html"], .ui-header-tools a[href="dashboard.html"]');

      userLinks.forEach(function (a) {
        if (user) {
          a.setAttribute('href', 'dashboard.html');
          a.setAttribute('title', 'My Account (' + (user.firstName || 'User') + ')');
          // Add small active dot
          var icon = a.querySelector('i');
          if (icon) {
            icon.className = 'fa-solid fa-user-check';
            icon.style.color = '#F5B900';
          }
        } else {
          a.setAttribute('href', 'login.html');
          a.setAttribute('title', 'Login / Signup');
          var icon = a.querySelector('i');
          if (icon) {
            icon.className = 'fa-regular fa-user';
            icon.style.color = '';
          }
        }
      });
    }
  };

  // Run on page load
  document.addEventListener('DOMContentLoaded', function () {
    CravAuth.updateHeaderUi();
  });

  window.CravAuth = CravAuth;
})(window);
