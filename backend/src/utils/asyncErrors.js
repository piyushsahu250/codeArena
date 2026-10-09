// Express 4 does not catch a rejected promise from an async route handler: without this, a handler that throws before it has answered (any of the routes
// that have no try/catch of their own) leaves the request hanging until the client gives up, and only logs an unhandledRejection. This patches Express's
// route Layer once, so a rejection (or a synchronous throw) is passed to the normal error middleware and the client gets a prompt JSON 500.
// Same technique as the express-async-errors package, kept in-repo so no dependency is added. Safe to require more than once.
const Layer = require("express/lib/router/layer");

if (!Layer.prototype.__asyncErrorsPatched) {
  Layer.prototype.handle_request = function handleRequestWithAsyncErrors(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // an error-handling middleware: not for normal requests
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === "function") result.catch(next);
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__asyncErrorsPatched = true;
}
