// Request-body checks for the submissions endpoints. A missing or non-text id used to reach the database layer and come back as a 500; it is now a 400 with a
// clear message. Nothing else about a request is rejected here (languages, code and answers are validated where they are used, as before).
const { ServiceError } = require("../../utils/serviceError");

const isId = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;

function requireIds(body, names) {
  const src = body && typeof body === "object" ? body : {};
  const out = {};
  for (const n of names) {
    if (!isId(src[n])) throw new ServiceError(400, `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} required`);
    out[n] = src[n];
  }
  return out;
}

module.exports = { requireIds, isId };
