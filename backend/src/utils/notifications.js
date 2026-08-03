const { sendMailLogged, wrapBranded } = require("./mailer");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena-app.vercel.app";

// Best-effort, non-throwing — same posture as logAudit() (a side-channel write must never fail
// the request it's describing). Writes the persisted in-app Notification row; the email half is
// a separate, also-best-effort call via sendMailLogged, fired by the event wrappers below.
async function notify(prisma, { recipientId, type, message, link, meta }) {
  try {
    await prisma.notification.create({ data: { recipientId, type, message, link: link || null, meta: meta || undefined } });
  } catch (err) {
    console.error("Failed to write notification:", err);
  }
}

async function notifyMany(prisma, recipientIds, { type, message, link, meta }) {
  if (!recipientIds || recipientIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: recipientIds.map((recipientId) => ({ recipientId, type, message, link: link || null, meta: meta || undefined })),
    });
  } catch (err) {
    console.error("Failed to write notifications:", err);
  }
}

async function emailStudent(prisma, student, subject, bodyHtml, emailType) {
  if (!student?.email) return;
  await sendMailLogged(prisma, {
    to: student.email, name: student.name, subject, html: wrapBranded(bodyHtml), emailType, studentId: student.id,
  }).catch(() => {});
}

async function notifyPoolAdded(prisma, student, pool) {
  const link = "/talent-pools";
  await Promise.all([
    notify(prisma, { recipientId: student.id, type: "TALENT_POOL_ADDED", message: `You've been added to the "${pool.name}" Talent Pool`, link }),
    emailStudent(
      prisma, student, `You've been added to "${pool.name}"`,
      `<p>Hi ${student.name},</p><p>You've been added to the <strong>${pool.name}</strong> Talent Pool. You may now have access to exclusive assessments and interviews reserved for this group.</p><p><a href="${FRONTEND_URL}${link}">View your Talent Pools</a></p>`,
      "TALENT_POOL_ADDED"
    ),
  ]);
}

async function notifyPoolRemoved(prisma, student, pool) {
  await Promise.all([
    notify(prisma, { recipientId: student.id, type: "TALENT_POOL_REMOVED", message: `You've been removed from the "${pool.name}" Talent Pool` }),
    emailStudent(
      prisma, student, `You've been removed from "${pool.name}"`,
      `<p>Hi ${student.name},</p><p>You've been removed from the <strong>${pool.name}</strong> Talent Pool. Any exclusive assessments assigned to that pool are no longer available to you.</p>`,
      "TALENT_POOL_REMOVED"
    ),
  ]);
}

// Fired once per assignment event, to every current member — students, so callers should pass
// the already-loaded member list (id+name+email) rather than re-querying here.
async function notifyAssessmentAssigned(prisma, members, pool, assessmentLabel) {
  const link = "/talent-pools";
  await Promise.all([
    notifyMany(prisma, members.map((m) => m.id), {
      type: "TALENT_POOL_ASSESSMENT_ASSIGNED",
      message: `New exclusive assessment "${assessmentLabel}" assigned to your "${pool.name}" Talent Pool`,
      link,
    }),
    ...members.map((m) =>
      emailStudent(
        prisma, m, `New assessment for "${pool.name}"`,
        `<p>Hi ${m.name},</p><p>A new exclusive assessment, <strong>${assessmentLabel}</strong>, has been assigned to your <strong>${pool.name}</strong> Talent Pool.</p><p><a href="${FRONTEND_URL}${link}">View your Talent Pools</a></p>`,
        "TALENT_POOL_ASSESSMENT_ASSIGNED"
      )
    ),
  ]);
}

async function notifyDeadlineReminder(prisma, student, pool, testTitle, startTime) {
  const link = "/talent-pools";
  await Promise.all([
    notify(prisma, {
      recipientId: student.id, type: "TALENT_POOL_DEADLINE_REMINDER",
      message: `"${testTitle}" (${pool.name}) starts ${new Date(startTime).toLocaleString()}`, link,
    }),
    emailStudent(
      prisma, student, `Reminder: "${testTitle}" starts soon`,
      `<p>Hi ${student.name},</p><p>Your exclusive assessment <strong>${testTitle}</strong> from the <strong>${pool.name}</strong> Talent Pool starts at ${new Date(startTime).toLocaleString()}.</p>`,
      "TALENT_POOL_DEADLINE_REMINDER"
    ),
  ]);
}

async function notifyResultsPublished(prisma, student, pool, testTitle) {
  const link = "/talent-pools";
  await Promise.all([
    notify(prisma, { recipientId: student.id, type: "TALENT_POOL_RESULTS_PUBLISHED", message: `Results published for "${testTitle}" (${pool.name})`, link }),
    emailStudent(
      prisma, student, `Results published: "${testTitle}"`,
      `<p>Hi ${student.name},</p><p>Results for <strong>${testTitle}</strong> (${pool.name} Talent Pool) are now available.</p><p><a href="${FRONTEND_URL}${link}">View your Talent Pools</a></p>`,
      "TALENT_POOL_RESULTS_PUBLISHED"
    ),
  ]);
}

// Result Management module — a published manual/offline exam result. Same shape as
// notifyResultsPublished (Talent Pool) above, kept as its own function since the two features are
// otherwise unrelated and a shared function would need to branch on which link/wording to use.
async function notifyResultPublished(prisma, student, examination) {
  const link = "/results";
  await Promise.all([
    notify(prisma, { recipientId: student.id, type: "RESULT_PUBLISHED", message: `Result published for "${examination.title}"`, link }),
    emailStudent(
      prisma, student, `Result published: "${examination.title}"`,
      `<p>Hi ${student.name},</p><p>Your result for <strong>${examination.title}</strong> is now available on your dashboard.</p><p><a href="${FRONTEND_URL}${link}">View your Results</a></p>`,
      "RESULT_PUBLISHED"
    ),
  ]);
}

module.exports = {
  notify, notifyMany, notifyPoolAdded, notifyPoolRemoved, notifyAssessmentAssigned, notifyDeadlineReminder, notifyResultsPublished,
  notifyResultPublished,
};
