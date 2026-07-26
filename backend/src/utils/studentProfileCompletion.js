// Single source of truth for what "Personal Academic & Info" completion means — reused by
// PATCH /profile/me (to persist StudentProfile.mandatoryStatus), the login/auth payload (to
// decide whether to gate navigation), and the admin/institute completion stats route. Never
// trust a client-computed completion flag; always recompute server-side from the raw data.
//
// Deliberately checks fields already living on User (name/mobile/gender/profilePhotoUrl) and on
// Resume (education, resume existence) rather than duplicating them on StudentProfile — see
// schema.prisma's StudentProfile model comment.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9]{10,15}$/;
const PINCODE_RE = /^[0-9]{4,10}$/;

const MANDATORY_FIELD_CHECKS = [
  { key: "name", label: "Full name (first and last)", check: (u) => !!u.name && u.name.trim().split(/\s+/).length >= 2 },
  { key: "mobile", label: "Mobile number", check: (u) => !!u.mobile && MOBILE_RE.test(u.mobile) },
  { key: "gender", label: "Gender", check: (u) => !!u.gender },
  { key: "profilePhotoUrl", label: "Profile picture", check: (u) => !!u.profilePhotoUrl },
  { key: "personalEmail", label: "Personal email", check: (u, p) => !!p?.personalEmail && EMAIL_RE.test(p.personalEmail) },
  { key: "dob", label: "Date of birth", check: (u, p) => !!p?.dob && new Date(p.dob).getTime() < Date.now() },
  { key: "address", label: "Address", check: (u, p) => !!p?.address },
  { key: "state", label: "State", check: (u, p) => !!p?.state },
  { key: "district", label: "District", check: (u, p) => !!p?.district },
  { key: "pincode", label: "Pincode", check: (u, p) => !!p?.pincode && PINCODE_RE.test(p.pincode) },
  { key: "fatherName", label: "Father's name", check: (u, p) => !!p?.fatherName },
  { key: "fatherContact", label: "Father's contact number", check: (u, p) => !!p?.fatherContact && MOBILE_RE.test(p.fatherContact) },
  { key: "motherName", label: "Mother's name", check: (u, p) => !!p?.motherName },
  { key: "motherContact", label: "Mother's contact number", check: (u, p) => !!p?.motherContact && MOBILE_RE.test(p.motherContact) },
  { key: "shortDescription", label: "Short description (About)", check: (u, p) => !!p?.shortDescription && p.shortDescription.trim().length >= 10 },
  { key: "education", label: "At least one education record", check: (u, p, resume) => Array.isArray(resume?.education) && resume.education.length > 0 },
  // GET /resume/me auto-creates an empty draft row on first visit to the Resume Builder page, so a
  // bare row-existence check would be satisfied without the student ever entering/uploading
  // anything. Require actual populated content (set either by manual entry or by the upload+parse
  // flow) instead of just the row existing.
  { key: "resume", label: "Resume", check: (u, p, resume) => !!resume?.fullName && !!resume?.email },
];

function computeMandatoryCompletion(user, studentProfile, resume) {
  const missingFields = [];
  for (const f of MANDATORY_FIELD_CHECKS) {
    if (!f.check(user, studentProfile, resume)) missingFields.push({ key: f.key, label: f.label });
  }
  const totalFields = MANDATORY_FIELD_CHECKS.length;
  const percent = Math.round(((totalFields - missingFields.length) / totalFields) * 100);
  const complete = missingFields.length === 0;
  const status = complete ? "COMPLETED" : percent > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  return { complete, percent, missingFields, totalFields, status };
}

module.exports = { computeMandatoryCompletion, MANDATORY_FIELD_CHECKS, EMAIL_RE, MOBILE_RE, PINCODE_RE };
