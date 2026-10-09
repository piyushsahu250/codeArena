// An expected failure raised by a service function: the controller turns it into an HTTP response with this status and message. Anything that is NOT a
// ServiceError is an unexpected fault (logged, answered with a generic 500). Keeps services free of req/res.
class ServiceError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.extra = extra || null;
  }
}
module.exports = { ServiceError };
