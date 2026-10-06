// Independent publishing for the Learning hierarchy:
//   Course -> Module -> Chapter -> { Reference Material (Lesson) , Coding Level -> Coding Question }
//
// Every level has its OWN publish state and publishing a parent never publishes a child. A student can
// only see an item when the WHOLE ancestor chain is live. Admins always see everything (drafts included).
//
// State is stored without a new enum so existing rows keep exactly the meaning they had:
//   isActive=true  & archivedAt=null  -> PUBLISHED   (this is what every existing row already is)
//   isActive=false & archivedAt=null  -> DRAFT
//   archivedAt set                    -> ARCHIVED   (hidden from students; nothing is ever deleted)
// Course keeps its own CourseStatus enum; Coding Questions use Question.questionStatus.

const LIVE = { isActive: true, archivedAt: null };

function statusOf(row) {
  if (!row) return "DRAFT";
  if (row.archivedAt) return "ARCHIVED";
  return row.isActive ? "PUBLISHED" : "DRAFT";
}

// Prisma `where` fragments a student-facing query ANDs in. Each one includes the ancestors below the
// course (the course itself is gated by status:"PUBLISHED" + eligibility at the route, as before).
const liveChapterWhere = { ...LIVE, module: { ...LIVE } };
const liveModuleWhere = { ...LIVE };
const liveLessonWhere = {
  ...LIVE,
  module: { ...LIVE },
  OR: [{ chapterId: null }, { chapter: { ...LIVE } }],
};
// A level hangs off a chapter (new model) or directly off a module (legacy module assessment).
const liveLevelWhere = {
  ...LIVE,
  OR: [
    { chapterId: null, module: { ...LIVE, course: { status: "PUBLISHED" } } },
    { chapter: { ...LIVE, module: { ...LIVE, course: { status: "PUBLISHED" } } } },
  ],
};
const liveQuestionWhere = { questionStatus: "PUBLISHED" };

// What to write for each action. Publish/Unpublish only touch THIS row.
const ACTIONS = {
  publish: () => ({ isActive: true, archivedAt: null, publishedAt: new Date() }),
  unpublish: () => ({ isActive: false }),
  archive: () => ({ isActive: false, archivedAt: new Date() }),
  restore: () => ({ archivedAt: null }), // comes back as Draft; an admin must publish again on purpose
};

module.exports = { LIVE, statusOf, liveChapterWhere, liveModuleWhere, liveLessonWhere, liveLevelWhere, liveQuestionWhere, ACTIONS };
