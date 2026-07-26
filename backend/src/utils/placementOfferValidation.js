// Shared "completion criteria" gate for a Placement Offer — reused by POST (create) and PATCH
// (edit) so a record can never exist in this platform without a proof link, matching the spec's
// "should not allow the offer to be saved" instruction literally. There is deliberately no
// separate INCOMPLETE/persisted-draft state — every row that exists already passed this check.

const OFFER_TYPES = ["INTERNSHIP", "PLACEMENT"];
const SOURCES = ["ON_CAMPUS", "OFF_CAMPUS"];
const OFFER_STATUSES = ["HOLDING", "ACCEPTED", "REJECTED"];
const JOINING_STATUSES = ["Joined", "Not Yet Joined", "Deferred"];
const URL_RE = /^https?:\/\/.+/i;

function validateOfferInput(body) {
  const { companyId, companyName, offerType, source, offeredPackage, offerStatus, joiningStatus, proofLink } = body || {};

  if (!companyName || !String(companyName).trim()) return "Company name is required";
  if (!OFFER_TYPES.includes(offerType)) return "Offer type must be Internship or Placement";
  if (!SOURCES.includes(source)) return "Source must be On-Campus or Off-Campus";
  const pkg = Number(offeredPackage);
  if (!Number.isFinite(pkg) || pkg <= 0) return "Offered package must be a positive number";
  if (offerStatus !== undefined && !OFFER_STATUSES.includes(offerStatus)) return "Invalid offer status";
  if (joiningStatus !== undefined && joiningStatus !== null && joiningStatus !== "" && !JOINING_STATUSES.includes(joiningStatus)) return "Invalid joining status";
  if (!proofLink || !URL_RE.test(String(proofLink).trim())) return "A valid document proof link (http/https URL) is required";

  return null;
}

module.exports = { validateOfferInput, OFFER_TYPES, SOURCES, OFFER_STATUSES, JOINING_STATUSES };
