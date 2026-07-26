// Shared validation for StudentDocument — mirrors placementOfferValidation.js's "no incomplete
// record can be saved" gate: every document needs a real shareable link (this platform has no
// in-house file storage, see PlacementOffer.proofLink), and MARKSHEET/OTHER need a label since
// a student can have several of each and the type alone doesn't distinguish them.

const DOCUMENT_TYPES = [
  { value: "RESUME", label: "Resume" },
  { value: "PHOTO", label: "Passport-size Photo" },
  { value: "AADHAAR", label: "Aadhaar Card (or institution-approved ID)" },
  { value: "PAN", label: "PAN Card" },
  { value: "MARKSHEET", label: "Semester Mark Sheet" },
  { value: "DEGREE_CERTIFICATE", label: "Degree / Provisional Certificate" },
  { value: "BONAFIDE_CERTIFICATE", label: "Bonafide Certificate" },
  { value: "GOVERNMENT_ID", label: "Government ID" },
  { value: "INTERNSHIP_CERTIFICATE", label: "Internship Certificate" },
  { value: "EXPERIENCE_CERTIFICATE", label: "Experience Certificate" },
  { value: "JOINING_LETTER", label: "Joining Letter" },
  { value: "RELIEVING_LETTER", label: "Relieving Letter" },
  { value: "SALARY_DETAILS", label: "Salary Package Details" },
  { value: "OTHER", label: "Other Supporting Document" },
];
const DOCUMENT_TYPE_VALUES = DOCUMENT_TYPES.map((t) => t.value);
const LABEL_REQUIRED_TYPES = ["MARKSHEET", "OTHER"];
const URL_RE = /^https?:\/\/.+/i;

function validateDocumentInput(body) {
  const { documentType, label, documentLink } = body || {};

  if (!DOCUMENT_TYPE_VALUES.includes(documentType)) return "Invalid document type";
  if (LABEL_REQUIRED_TYPES.includes(documentType) && !String(label || "").trim()) {
    return "A label is required for this document type (e.g. 'Semester 5 Mark Sheet')";
  }
  if (!documentLink || !URL_RE.test(String(documentLink).trim())) return "A valid document link (http/https URL) is required";

  return null;
}

module.exports = { validateDocumentInput, DOCUMENT_TYPES, DOCUMENT_TYPE_VALUES };
