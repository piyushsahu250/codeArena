// HTTP in, HTTP out for the authentication routes. Reads the body, calls the service and maps results and ServiceErrors to responses. An unexpected fault is
// logged and answered with a fixed message per route, as the routes this replaced did.
const { ServiceError } = require("../../utils/serviceError");
const service = require("./auth.service");

function handler(fallback, fn, { logFault = true } = {}) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      if (logFault) console.error(err);
      res.status(500).json({ error: fallback });
    }
  };
}

// Self-registration is disabled: every account is created by an administrator. The route only gives anyone hitting it directly a clear message.
const register = (req, res) => res.status(403).json({ error: service.registrationDisabled() });

const login = handler("Login failed", (req) => service.login(req, req.body));
const permissions = handler("Could not load permissions", (req) => service.permissions(req.user), { logFault: false });
const logout = handler("Logout failed", (req) => service.logout(req));
const forgotPassword = handler("Failed to process request", (req) => service.forgotPassword(req, req.body));
const resetPassword = handler("Failed to reset password", (req) => service.resetPassword(req, req.body));
const verifyEmail = handler("Failed to verify email", (req) => service.verifyEmail(req, req.body));

module.exports = { register, login, permissions, logout, forgotPassword, resetPassword, verifyEmail };
