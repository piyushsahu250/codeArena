// Single source of truth for what "Personal Academic & Info" completion means — reused by
// PATCH /profile/me (to persist StudentProfile.mandatoryStatus), the login/auth payload (to
// decide whether to gate navigation), and the admin/institute completion stats route. Never
// trust a client-computed completion flag; always recompute server-side from the raw data.
//
// Deliberately checks fields already living on User (name/mobile/gender/profilePhotoUrl) and on
// Resume (education) rather than duplicating them on StudentProfile — see schema.prisma's
// StudentProfile model comment.
//
// Every check is tagged with the page ("PROFILE" or "RESUME") where the student actually fills
// it in. Profile is the single source of truth for identity fields — Resume Builder no longer
// collects them (it reads them via write-through sync from profile.js) — and Resume Builder owns
// only resume-specific content (Education). The frontend uses this tag to route "complete this"
// guidance to the correct page instead of a generic warning.

const { isValidEmail } = require("./emailValidation");
const MOBILE_RE = /^\+?[0-9]{10,15}$/;
const PINCODE_RE = /^[0-9]{4,10}$/;

// Students are let into the rest of the platform once they've filled in most (not all) of the
// mandatory checklist, rather than being blocked on the very last field or two — `complete` below
// still means literally 100% (used for admin reporting and the mandatoryCompletedAt timestamp),
// `unlocked` is the separate, looser threshold that actually gates navigation.
const UNLOCK_THRESHOLD_PERCENT = 80;

const MANDATORY_FIELD_CHECKS = [
  { key: "name", label: "Full name (first and last)", section: "PROFILE", check: (u) => !!u.name && u.name.trim().split(/\s+/).length >= 2 },
  { key: "mobile", label: "Mobile number", section: "PROFILE", check: (u) => !!u.mobile && MOBILE_RE.test(u.mobile) },
  { key: "gender", label: "Gender", section: "PROFILE", check: (u) => !!u.gender },
  { key: "profilePhotoUrl", label: "Profile picture", section: "PROFILE", check: (u) => !!u.profilePhotoUrl },
  { key: "personalEmail", label: "Personal email", section: "PROFILE", check: (u, p) => !!p?.personalEmail && isValidEmail(p.personalEmail) },
  { key: "dob", label: "Date of birth", section: "PROFILE", check: (u, p) => !!p?.dob && new Date(p.dob).getTime() < Date.now() },
  { key: "address", label: "Address", section: "PROFILE", check: (u, p) => !!p?.address },
  { key: "state", label: "State", section: "PROFILE", check: (u, p) => !!p?.state },
  { key: "district", label: "District", section: "PROFILE", check: (u, p) => !!p?.district },
  { key: "pincode", label: "Pincode", section: "PROFILE", check: (u, p) => !!p?.pincode && PINCODE_RE.test(p.pincode) },
  { key: "fatherName", label: "Father's name", section: "PROFILE", check: (u, p) => !!p?.fatherName },
  { key: "fatherContact", label: "Father's contact number", section: "PROFILE", check: (u, p) => !!p?.fatherContact && MOBILE_RE.test(p.fatherContact) },
  { key: "motherName", label: "Mother's name", section: "PROFILE", check: (u, p) => !!p?.motherName },
  { key: "motherContact", label: "Mother's contact number", section: "PROFILE", check: (u, p) => !!p?.motherContact && MOBILE_RE.test(p.motherContact) },
  { key: "shortDescription", label: "Short description (About)", section: "PROFILE", check: (u, p) => !!p?.shortDescription && p.shortDescription.trim().length >= 10 },
  { key: "education", label: "At least one education record", section: "RESUME", check: (u, p, resume) => Array.isArray(resume?.education) && resume.education.length > 0 },
  { key: "documents", label: "At least one uploaded document", section: "DOCUMENTS", check: (u, p, resume, documents) => Array.isArray(documents) && documents.length > 0 },
];

function computeMandatoryCompletion(user, studentProfile, resume, documents) {
  const missingFields = [];
  for (const f of MANDATORY_FIELD_CHECKS) {
    if (!f.check(user, studentProfile, resume, documents)) missingFields.push({ key: f.key, label: f.label, section: f.section });
  }
  const totalFields = MANDATORY_FIELD_CHECKS.length;
  const percent = Math.round(((totalFields - missingFields.length) / totalFields) * 100);
  const complete = missingFields.length === 0;
  const unlocked = percent >= UNLOCK_THRESHOLD_PERCENT;
  const status = complete ? "COMPLETED" : percent > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  return { complete, unlocked, percent, missingFields, totalFields, status };
}

module.exports = { computeMandatoryCompletion, MANDATORY_FIELD_CHECKS, MOBILE_RE, PINCODE_RE, UNLOCK_THRESHOLD_PERCENT };
