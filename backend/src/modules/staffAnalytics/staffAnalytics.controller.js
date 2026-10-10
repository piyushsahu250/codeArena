// HTTP in, HTTP out for /api/staff-analytics. Reads the request, builds the acting-user object from the AUTHENTICATED user (never from the body or query),
// calls the service and maps ServiceError to a status. Exports are streamed in csv / xlsx / pdf.
const { safeErrorMessage } = require("../../utils/errors");
const { ServiceError } = require("../../utils/serviceError");
const { sendExport } = require("../../utils/exportFile");
const { sendPdfTable } = require("../../utils/pdfTable");
const d = require("./staffAnalytics.domain");
const service = require("./staffAnalytics.service");

const actor = (req) => service.actorOf(req.user, req.requesterInstituteId, req);

function handler(fallback, fn) {
  return async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store"); // personal activity data: never cached by a shared proxy or the browser
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
      console.error("[staff-analytics]", err);
      res.status(500).json({ error: safeErrorMessage(err, fallback) });
    }
  };
}

const meta = handler("Couldn't load the analytics definitions.", (req) => service.meta(actor(req)));
const summary = handler("Couldn't load the analytics summary.", (req) => service.summary(actor(req), req.query));
const people = handler("Couldn't load the staff list.", (req) => service.people(actor(req), req.query, d.pageParams(req.query)));
const person = handler("Couldn't load this person's analytics.", (req) => service.personDetail(actor(req), req.params.id, req.query));
const personEvents = handler("Couldn't load the activity log.", (req) => service.personEvents(actor(req), req.params.id, req.query, d.pageParams(req.query, { defaultSize: 25, maxSize: 100 })));
const compare = handler("Couldn't compare these people.", (req) => service.compare(actor(req), req.query.ids, req.query));
const me = handler("Couldn't load your activity.", (req) => service.me(actor(req), req.query));
const meEvents = handler("Couldn't load your activity log.", (req) => service.personEvents(actor(req), req.user.id, req.query, d.pageParams(req.query), { self: true }));

async function exportReport(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const out = await service.exportData(actor(req), req.query);
    if (out.rows.length === 0) return res.status(204).end();
    const format = String(req.query.format || "csv").toLowerCase();
    if (!["csv", "xlsx", "pdf"].includes(format)) throw new ServiceError(400, "format must be csv, xlsx or pdf");
    if (format === "pdf") return sendPdfTable(res, { title: out.title, meta: out.meta, rows: out.rows, filenameBase: out.filenameBase });
    return sendExport(res, { rows: out.rows, filenameBase: out.filenameBase, format });
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    console.error("[staff-analytics/export]", err);
    res.status(500).json({ error: "Export failed" });
  }
}

module.exports = { meta, summary, people, person, personEvents, compare, me, meEvents, exportReport };
