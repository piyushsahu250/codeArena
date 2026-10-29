// Whether finishing a learning course issues a certificate. An administrator can switch a course's certificate off (Course.certificateEnabled = false). That stops new certificates;
// a certificate a student already holds stays valid, visible and downloadable, because it was earned under the rules at the time and the switch is not a revocation.
// Pure: no Prisma client, so test/courseCertificatePolicy.test.js can check every case.

// `existingCertificate` is the student's LEARNING_MODULE certificate for this course, or null.
function certificateOffered(course, existingCertificate) {
  if (existingCertificate) return true;
  return !course || course.certificateEnabled !== false; // a course row from before the column existed counts as enabled
}

// Reads the flag from a request body: a real boolean, or the strings "true"/"false" a form may send. Anything else is ignored (undefined) so a PATCH that does not mention it changes nothing.
function parseCertificateEnabled(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

module.exports = { certificateOffered, parseCertificateEnabled };
