// A raw Prisma error's own `.message` can leak schema/table/field details to the client — a raw
// P2002's constraint target, or a PrismaClientValidationError's full invocation dump (argument
// names, model shape). An app-thrown validation Error (e.g. "Invalid function signature: ...")
// has a hand-written, already-safe message, so it's fine to surface as-is. This is the one signal
// that reliably tells the two apart: every Prisma error class name starts with "Prisma".
function safeErrorMessage(err, fallback) {
  if (err && typeof err.name === "string" && err.name.startsWith("Prisma")) return fallback;
  return err?.message || fallback;
}

module.exports = { safeErrorMessage };
