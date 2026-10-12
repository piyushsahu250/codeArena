// Question-bank bulk import: the quiz (MCQ, True/False, Multiple Select), coding and combined imports, each as a direct import, a preview and a confirm. All of them
// share one core per question kind, so a preview can never decide differently from the confirm that follows it: `commit: false` runs every check and resolves the
// subject, unit, difficulty, options and images exactly as `commit: true` does and only skips the writes. A duplicate check re-reads the database on every call.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/question-import-export-contract.json).
// `req` below is the request object the shared visibility and subject-access helpers expect (it carries `user` and `requesterInstituteId`).
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { ownsQuestionRow } = require("../../utils/questionVisibility");
const { canStaffUseSubject, staffAuthorizedSubjectIds } = require("../../utils/subjectAccess");
const { normalizeOptions } = require("../../utils/mcqOptions");
const { resolveCodingFields } = require("../../utils/functionHarness");
const { splitLetterList, resolveCorrectLetterToken } = require("../../utils/bulkQuestionParser");
const { safeErrorMessage } = require("../../utils/errors");
const { extractImageZip, validateZipImage } = require("../../utils/bulkImageZip");
const questionImages = require("../../utils/questionImages");
const { parseBtlLevel } = require("./questions.domain");
const repo = require("./questions.repository");
const {
  TYPE_ALIASES, DIFFICULTY_ALIASES, LANGUAGE_ALIASES, EMPTY_BULK_RESULT, normalizeUnitName, normalizeHeader, buildHeaderMap, buildCodingHeaderMap, parseHiddenTestCases,
  parseUploadedFile, parseUploadedFileBothSheets, tagSheet,
} = require("./questions.import.domain");

// Subject" rule (spec section 8's exact rejection example: a Unit named the same as one under a
// different Subject is rejected, not silently accepted). Topic is create-if-missing (case-
// insensitive), matching the manual /subjects/units/:id/topics route, since it's optional/
// lightweight by design — unlike Subject/Unit, which must already exist (see "Subject-First
// Workflow", spec section 9: pick from what's already configured, don't type a new one mid-upload).
async function resolveSubjectUnitTopicByName(req, { subjectName, unitName, topicName }, { commit = true } = {}) {
  if (!subjectName) return { error: "Subject is required" };
  if (!unitName) return { error: "Unit is required" };
  const institute = req.requesterInstituteId ? { OR: [{ instituteId: req.requesterInstituteId }, { instituteId: null }] } : {};
  // findMany, not findFirst: the same Subject name can legitimately exist twice — once shared
  // (instituteId null) and once owned by a specific institute (e.g. two different "Java" rows).
  // findFirst with no orderBy picked whichever one Postgres happened to return first, and if THAT
  // one wasn't the requester's to use while the other genuinely was, every row in the file failed
  // with "not found or not authorized" even though a usable "Java" subject existed the whole time.
  // Try the requester's own institute's copy before the shared one — it's the more specific,
  // almost-certainly-intended match — and only fall through to the generic error if literally none
  // of the same-named candidates are usable.
  const subjectCandidates = await repo.findSubjectsByName({
    where: { ...institute, name: { equals: subjectName, mode: "insensitive" } },
    orderBy: { instituteId: { sort: "desc", nulls: "last" } }, // requester's own institute (non-null) before the shared (null) one
  });
  let subject = null;
  for (const candidate of subjectCandidates) {
    if (await canStaffUseSubject(req, candidate.id)) { subject = candidate; break; }
  }
  if (!subject) {
    // Same self-diagnosing-error treatment as the Unit mismatch below: list what this requester
    // can actually use instead of leaving them to guess-and-retry blind. Scoped to their own
    // authorized subjects (staffAuthorizedSubjectIds — null/unrestricted for ADMIN-tier roles), so
    // this never reveals a subject they don't already have access to.
    const authorizedIds = await staffAuthorizedSubjectIds(req);
    const availableWhere = authorizedIds ? { ...institute, id: { in: [...authorizedIds] } } : institute;
    const available = await repo.listSubjectNames({
      where: availableWhere, select: { name: true }, distinct: ["name"], orderBy: { name: "asc" }, take: 20,
    });
    const list = available.map((s) => `"${s.name}"`).join(", ") || "(no subjects configured for you yet)";
    return { error: `Subject "${subjectName}" not found or you're not authorized to use it. Subjects available to you: ${list}` };
  }
  let unit = await repo.findUnitByName(subject.id, unitName);
  if (!unit) {
    // Exact match failed — try Roman<->Arabic numeral normalization next. Only auto-resolved when
    // it's unambiguous (exactly one configured unit normalizes to the same string).
    const wantedNormalized = normalizeUnitName(unitName);
    const candidates = await repo.listUnits(subject.id);
    const normalizedMatches = candidates.filter((u) => normalizeUnitName(u.name) === wantedNormalized);
    if (normalizedMatches.length === 1) {
      unit = normalizedMatches[0];
    } else if (normalizedMatches.length === 0) {
      // No existing Unit matches even loosely — auto-create it under this Subject, the same
      // create-if-missing convention Topic already uses one level below. Unit used to be a hard
      // "must already exist, configure it through the UI first" requirement, which meant a
      // Subject with zero Units configured yet rejected every single bulk-upload row outright —
      // confirmed live 2026-09-11: a staff member bulk-uploading 20 Cybersecurity questions
      // against "Unit 4" hit exactly this wall because the Cybersecurity subject had no Units
      // configured at all. Deterministic and safe: it creates a Unit with the exact name the
      // staff member typed, under the Subject they already confirmed access to — never guesses
      // at a DIFFERENT existing Unit, which is exactly what the Roman-numeral branch above and
      // the ambiguous-match branch below still exist to handle carefully instead.
      // Declared change: a PREVIEW created the unit (and, below, the topic) although a preview must never write; it now only reports that they would be created.
      if (!commit) return { subjectId: subject.id, unitId: null, topicId: null, unitIsNew: true };
      unit = await repo.createUnit(subject.id, unitName);
    } else {
      // Genuinely ambiguous — more than one existing Unit already normalizes to the same string
      // (e.g. both "Unit 4" and "UNIT-4" exist as separate rows already). Auto-creating a third
      // would only add to that mess; this is exactly the case that still needs a human decision,
      // so it still hard-errors rather than guessing.
      const available = candidates.map((u) => `"${u.name}"`).join(", ");
      return { error: `"${unitName}" matches multiple existing units for Subject "${subjectName}": ${available}. Please use one of those exact names.` };
    }
  }
  let topicId = null;
  if (topicName) {
    let topic = await repo.findTopicByName(unit.id, topicName);
    if (!topic && commit) topic = await repo.createTopic(unit.id, topicName);
    topicId = topic ? topic.id : null;
  }
  return { subjectId: subject.id, unitId: unit.id, topicId };
}



// Reads the optional "imagesZip" field a bulk-import request may carry (see
// uploadQuestionFileWithImages/uploadImagesZipOnly above) and extracts it via
// utils/bulkImageZip.js. Returns { imageZip: null, error: null } when no zip was uploaded at all
// -- a perfectly normal case, most bulk uploads have no images -- or { imageZip, error } once one
// was. `imageZip` is the exact shape runQuizBulkImport/runCodingBulkImport expect.
function extractImageZipFromRequest(req) {
  const zipFile = req.files?.imagesZip?.[0];
  if (!zipFile) return { imageZip: null, error: null };
  const { filesByName, error } = extractImageZip(zipFile.buffer);
  if (error) return { imageZip: null, error };
  return { imageZip: { filesByName }, error: null };
}

// Shared core for quiz-type (MCQ/TRUE_FALSE/MULTISELECT) bulk import — used by all three routes
// below (immediate file import, preview, and confirm-after-preview) so there is exactly one place
// that decides what's valid, what's a duplicate, and what gets written. `commit: false` (preview)
// runs every check and resolves subject/unit/BTL/options exactly as commit: true does, it just
// never calls prisma.question.create — so a preview can never diverge from what confirming the
// same rows would actually do. Duplicate-detection re-queries the DB fresh every call (never
// trusts a cached "was valid at preview time" flag), so a confirm always reflects current state
// even if something else changed in between.
// `imageZip` is the { filesByName } map from utils/bulkImageZip.js's extractImageZip, or null if
// no images ZIP was uploaded alongside this file at all. A row naming an Image File Name when
// imageZip is null is exactly as much an error as one naming a file the zip doesn't contain --
// spec: never import a question as if its image exists when it doesn't.
async function runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, commit) {
  const headers = Object.keys(rows[0] || {});
  const headerMap = buildHeaderMap(headers);
  // Question Type is optional (auto-detected per row when the column/value is absent — see below);
  // only Question Text is a genuinely hard requirement to import anything at all.
  if (!headerMap.description) {
    return { error: "Missing required column. The file must include Question Text." };
  }
  // A column that didn't map to anything this importer recognizes (a stray "Teacher Notes",
  // "Comments", a leftover column from a different template) is never a reason to fail the whole
  // upload — its data is simply never read. Surfaced once, file-level, so a staff member can
  // confirm that was deliberate rather than silently wondering where a column went.
  const mappedHeaders = new Set(Object.values(headerMap));
  const unknownColumns = headers.filter((h) => !mappedHeaders.has(h));

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const created = [];
  const skipped = [];
  const errors = [];
  // Deterministic, safe corrections actually applied while reading a row (whitespace/case/
  // punctuation normalization only — never anything that could change what the row means) are
  // recorded here so the preview can show staff exactly what was auto-fixed, per spec: "never
  // silently change content" means never HIDING that a change happened, not never normalizing
  // formatting at all. See recordAutoFix() below.
  const autoFixed = [];
  let unrecognizedTypeCount = 0;
  let attemptedRowCount = 0; // non-blank rows actually evaluated -- the denominator for structureHint below
  const seenDescriptions = new Set();
  const existingDescriptionsByScope = new Map();

  async function existingDescriptions(fId, subjectId, unitId, unitIsNew) {
    if (unitIsNew) return new Set(); // a unit that does not exist yet (a preview) holds no questions
    const key = `${fId || ""}::${subjectId || ""}::${unitId || ""}`;
    if (!existingDescriptionsByScope.has(key)) {
      const rows = await repo.existingDescriptionRows(req, { folderId: fId, subjectId, unitId });
      existingDescriptionsByScope.set(key, new Set(rows.map((r) => (r.description || "").trim().toLowerCase()).filter(Boolean)));
    }
    return existingDescriptionsByScope.get(key);
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const row = rows[i];
    const title = field(row, "title");
    const description = field(row, "description");
    const typeRaw = field(row, "questionType");

    if (!title && !description && !typeRaw) continue; // blank row
    attemptedRowCount++;

    if (!description) { errors.push({ row: rowNum, reason: "Missing Question Text" }); continue; }

    // Simple template: separate Option A/B/.../F columns, preferred over the packed "Options"
    // column when any are present — the faculty-facing redesign this replaces pipe-delimited
    // options with. Falls back to "Options" untouched for any existing file/template still using
    // the old packed column, so nothing already relying on it breaks.
    const separateOptions = ["optionA", "optionB", "optionC", "optionD", "optionE", "optionF"]
      .map((k) => field(row, k)).filter((v) => v !== "");
    const optionsRaw = separateOptions.length > 0
      ? separateOptions
      : field(row, "options").split("|").map((s) => s.trim()).filter(Boolean);
    // Correct Option as a letter (A/B/C/D, case-insensitive, with an optional "Option "/"Answer "/
    // "Choice " prefix, optional surrounding "()", and an optional trailing "." or ")" -- covers
    // " a ", "a", "A.", "a)", "(A)", "option a", etc., all deterministically the same single
    // answer) resolves against optionsRaw's own position — A is whichever option ended up first
    // regardless of which column shape supplied it. Multiple Selection's "A,C,D" convention (and
    // its "A, C, D" / "A C D" / "A+C+D" variants -- see splitLetterList above) is split into
    // per-letter tokens first; anything that isn't a recognizable single letter (option text, a
    // 1-based number) is passed through untouched to normalizeCorrectIndices, which already
    // handles those.
    const correctAnswerFieldRaw = field(row, "correctAnswer");
    let letterFixApplied = false; // true only when a token was actually resolved as an A-F letter reference
    const correctAnswerRaw = (splitLetterList(correctAnswerFieldRaw) || correctAnswerFieldRaw.split(/[,|]/))
      .map((tok) => {
        const resolved = resolveCorrectLetterToken(tok);
        if (resolved !== null) { letterFixApplied = true; return resolved; }
        return String(tok).trim();
      })
      .join(",");
    // Recorded ONLY when a genuine letter-reference token was resolved (never for a free-text
    // answer, which is passed through completely untouched above and can never set this flag) AND
    // the resulting string actually differs from what was typed -- e.g. " a , c " -> "1,3",
    // "A." -> "1". This is purely a transparency log (spec: "never silently change content" means
    // the staff member reviewing the preview can always see exactly what was auto-fixed and why),
    // not a second source of truth -- correctAnswerRaw above is what's actually used either way.
    if (letterFixApplied && correctAnswerRaw !== correctAnswerFieldRaw.trim()) {
      autoFixed.push({ row: rowNum, field: "Correct Option(s)", before: correctAnswerFieldRaw.trim(), after: correctAnswerRaw });
    }
    const pointsRaw = field(row, "points");
    const difficultyRaw = field(row, "difficulty");
    const explanation = field(row, "explanation");

    // Question Type is optional — the simple template has no such column at all. Auto-detected the
    // same way the Notepad upload format already does: exactly 2 options that are literally
    // True/False -> True/False; more than one Correct Option token -> Multiple Select; otherwise
    // Multiple Choice. An explicit Question Type column, when present, always wins.
    let questionType = typeRaw ? TYPE_ALIASES[normalizeHeader(typeRaw)] : undefined;
    if (!questionType && !typeRaw) {
      const isTrueFalse = optionsRaw.length === 2 && optionsRaw.every((o) => /^(true|false)$/i.test(o));
      const correctCount = correctAnswerRaw.split(",").map((s) => s.trim()).filter(Boolean).length;
      questionType = isTrueFalse ? "TRUE_FALSE" : correctCount > 1 ? "MULTISELECT" : "MCQ";
    }
    if (!questionType) {
      unrecognizedTypeCount++;
      // Confirmed live: a user's own spreadsheet (not our template) can have a "Question Type"-
      // named column whose actual data is really something else (options text, a topic name, etc.)
      // — the raw cell value dumped in full made a wall of unreadable text out of one bad column
      // mapping. Truncated here, and the accepted values spelled out, so one row's error is
      // actually readable; the systemic case (every/most rows wrong the same way -> structureHint
      // below) is what actually explains what's going on.
      const shown = typeRaw.length > 40 ? `${typeRaw.slice(0, 40)}…` : typeRaw;
      errors.push({ row: rowNum, reason: `Unrecognized Question Type "${shown}" — expected MCQ, True/False, or Multiple Select` });
      continue;
    }
    if (questionType === "CODING") {
      errors.push({ row: rowNum, reason: "Coding questions use the separate coding-question bulk upload (different template/columns), not this one" });
      continue;
    }

    const subject = field(row, "subject");
    const unit = field(row, "unit");
    const topic = field(row, "topic");
    const resolvedSubject = await resolveSubjectUnitTopicByName(req, { subjectName: subject, unitName: unit, topicName: topic }, { commit });
    if (resolvedSubject.error) { errors.push({ row: rowNum, reason: resolvedSubject.error }); continue; }

    // An unrecognized (non-blank) Difficulty is auto-corrected to Medium rather than blocking the
    // row outright — confirmed live 2026-09-11: a real generated question bank used values like
    // "Confusing"/"Difficult" that don't cleanly map to Easy/Medium/Hard, and rejecting every one
    // of those rows meant the only way to import anything was hand-editing the spreadsheet first.
    // "Difficult"/"Tough"/etc. are now recognized aliases (see DIFFICULTY_ALIASES) and resolve
    // exactly like "Hard" always did; only a value that STILL doesn't match anything recognizable
    // falls back to Medium. Never silent, though — recorded in autoFixed exactly like every other
    // correction here, so a staff member reviewing the preview can see it happened and fix it
    // properly later if Medium wasn't the right call for that specific question.
    if (difficultyRaw && !DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)]) {
      autoFixed.push({ row: rowNum, field: "Difficulty", before: difficultyRaw, after: "Medium (unrecognized value)" });
    }

    // Optional image attachment. A row that names one is validated up front (same "clear error,
    // never a silent partial import" treatment as every other required field) -- never created
    // as if the image existed when it didn't, per spec.
    const imageFileNameRaw = field(row, "imageFileName");
    let imageBuffer = null;
    let imageMime = null;
    if (imageFileNameRaw) {
      if (commit && !questionImages.isConfigured()) {
        errors.push({ row: rowNum, reason: "Image storage isn't configured on this server yet — remove the Image File Name or try again later" });
        continue;
      }
      if (!imageZip) {
        errors.push({ row: rowNum, reason: `Image "${imageFileNameRaw}" was referenced but no images ZIP was uploaded alongside this file` });
        continue;
      }
      const basename = imageFileNameRaw.split("/").pop().split("\\").pop();
      const found = imageZip.filesByName.get(basename.toLowerCase());
      const { mime, error: imageError } = validateZipImage(found, imageFileNameRaw);
      if (imageError) {
        errors.push({ row: rowNum, reason: imageError });
        continue;
      }
      imageBuffer = found;
      imageMime = mime;
    }

    const descKey = description.trim().toLowerCase();
    if (duplicateAction !== "import") {
      if (seenDescriptions.has(descKey)) {
        skipped.push({ row: rowNum, reason: "Duplicate question text within this file" });
        continue;
      }
      const existing = await existingDescriptions(folderId, resolvedSubject.subjectId, resolvedSubject.unitId, resolvedSubject.unitIsNew);
      if (existing.has(descKey)) {
        skipped.push({ row: rowNum, reason: "A question with this text already exists under that Subject/Unit" });
        continue;
      }
    }

    try {
      const normalized = normalizeOptions(questionType, optionsRaw, correctAnswerRaw);
      const btlLevel = parseBtlLevel(field(row, "btl"));
      const data = {
        title: title || null,
        description,
        subject: subject || null,
        topic: topic || null,
        subjectId: resolvedSubject.subjectId,
        unitId: resolvedSubject.unitId,
        topicId: resolvedSubject.topicId,
        questionType,
        // Blank cell (no difficulty given at all) still defaults to Easy, unchanged; a non-blank
        // but unrecognized value defaults to Medium instead, matching the autoFixed message above.
        difficulty: DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || (difficultyRaw ? "MEDIUM" : "EASY"),
        btlLevel,
        points: Number(pointsRaw) || 10,
        explanation: explanation || null,
        options: normalized.options,
        correctAnswer: normalized.correctAnswer,
        instituteId: req.requesterInstituteId,
        folderId,
        createdById: req.user.id,
      };
      if (commit) {
        let question = await repo.createQuestionBare(data);
        if (imageBuffer) {
          // Uploaded only now, after the question row itself exists (S3 keys are namespaced by
          // question id) and only ever for a REAL commit -- a preview never touches S3 at all, so
          // cancelling out of a preview never leaves an orphaned upload behind.
          try {
            const imageKey = await questionImages.uploadQuestionImage(question.id, imageBuffer, imageMime);
            question = await repo.updateQuestionBare(question.id, { imageKey, imageMimeType: imageMime });
          } catch (imgErr) {
            // The question itself was already created successfully -- an image upload failure
            // (S3 hiccup, not configured on this server) shouldn't un-create it or silently
            // pretend the whole row failed. Surfaced as a warning-shaped error entry instead so
            // staff can see it and re-attach the image via the question's own Edit screen.
            errors.push({ row: rowNum, reason: `Question created, but its image failed to upload: ${safeErrorMessage(imgErr, "unknown error")}` });
          }
        }
        created.push(question);
      } else {
        created.push({ row: rowNum, title: title || null, description, questionType, difficulty: data.difficulty, btlLevel, hasImage: !!imageBuffer });
      }
      seenDescriptions.add(descKey);
      (await existingDescriptions(folderId, resolvedSubject.subjectId, resolvedSubject.unitId, resolvedSubject.unitIsNew)).add(descKey);
    } catch (err) {
      errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
    }
  }

  if (commit && created.length > 0) {
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { count: created.length, folderId },
    });
  }
  // Only present (and only meaningful) on a preview — the exact original row data the frontend
  // should re-post to /bulk-import/confirm once the staff member is happy with the summary.
  // Built from `created`'s row numbers (commit: false pushes a {row, ...} marker there instead of
  // an actual Question) rather than re-deriving "was this row valid" from scratch, so it can never
  // drift from what the counts above actually say passed.
  const validRows = commit ? undefined : created.map((c) => rows[c.row - 2]);

  // Confirmed live: a real upload where every one of 30 rows failed with "Unrecognized Question
  // Type" (the actual cell value was clearly Options text, not a type) produced 30 near-identical
  // giant error lines and no indication of WHY -- the header-name matching found a "Question Type"
  // column, but that column's data in the user's own file doesn't line up with our template's
  // column order. One clear, file-level diagnostic here (surfaced as a banner above the per-row
  // list, not buried in it) turns "30 walls of red text" into one fixable takeaway.
  let structureHint = null;
  if (attemptedRowCount >= 3 && unrecognizedTypeCount === attemptedRowCount) {
    structureHint = "Every row in this file has an unrecognized Question Type. This almost always means your spreadsheet's columns don't match our template's order (e.g. a column is missing, extra, or shifted) rather than 30 individual typos. Download the template below and copy your data into it column-by-column, or reorder your existing columns to match it exactly.";
  } else if (attemptedRowCount >= 5 && unrecognizedTypeCount / attemptedRowCount >= 0.8) {
    structureHint = "Most rows in this file have an unrecognized Question Type. Check that your Question Type column only contains MCQ, True/False, or Multiple Select, and that your columns are in the same order as our template.";
  }

  return {
    total: rows.length, createdCount: created.length, skippedCount: skipped.length, errorCount: errors.length,
    skipped, errors, created, validRows, structureHint,
    autoFixedCount: autoFixed.length, autoFixed, unknownColumns,
    // On preview, `created` holds the lightweight {row, ..., hasImage} marker; on a real commit
    // it holds the actual created Question rows, which carry imageKey once the S3 upload inside
    // the commit branch above succeeded — either shape is covered here.
    imagesValidatedCount: created.filter((c) => c.hasImage || c.imageKey).length,
  };
}

// Bulk-import CODING questions from .xlsx/.csv — see CODING_TEMPLATE_HEADERS for the column
// layout and the module-level comment above it for the hidden-test-case cell format. Each row can
// name its own destination Question Bank (created if it doesn't exist yet); a row with no bank
// name falls back to the `folderId` sent with the upload (the same "Save to Question Bank" picker
// used for quiz bulk-import), and no bank at all leaves the question unfiled.
// Shared core for CODING bulk import — same "one function, commit true/false" design as
// runQuizBulkImport above, for the same reason (a preview must run exactly the logic a confirm
// would). The one side-effect a plain validation pass would normally cause — auto-creating a
// named Question Bank folder that doesn't exist yet (resolveBankFolder below) — is suppressed
// when commit is false, since Preview must never write anything; the folder is created for real
// only when this same function is called again with commit: true at confirm time.
async function runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction, imageZip }, commit) {
  const codingHeaders = Object.keys(rows[0] || {});
  const headerMap = buildCodingHeaderMap(codingHeaders);
  if (!headerMap.title || !headerMap.description) {
    return { error: "Missing required columns. The file must include Question Title and Problem Statement." };
  }
  // Same file-level "we ignored this column" notice as the quiz importer — see its own comment.
  const mappedCodingHeaders = new Set(Object.values(headerMap));
  const unknownColumns = codingHeaders.filter((h) => !mappedCodingHeaders.has(h));

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const created = [];
  const skipped = [];
  const errors = [];
  // Same deterministic-corrections transparency log as the quiz importer — see its own comment.
  const autoFixed = [];
  const seenTitles = new Set();
  const folderIdByName = new Map();
  const existingTitlesByScope = new Map();

  async function existingTitles(folderId, subjectId, unitId, unitIsNew) {
    if (unitIsNew) return new Set(); // a unit that does not exist yet (a preview) holds no questions
    const key = `${folderId || ""}::${subjectId || ""}::${unitId || ""}`;
    if (!existingTitlesByScope.has(key)) {
      const rows = await repo.existingTitleRows(req, { folderId, subjectId, unitId });
      existingTitlesByScope.set(key, new Set(rows.map((r) => (r.title || "").toLowerCase()).filter(Boolean)));
    }
    return existingTitlesByScope.get(key);
  }

  async function resolveBankFolder(name) {
    if (!name) return defaultFolderId;
    const key = name.toLowerCase();
    if (folderIdByName.has(key)) return folderIdByName.get(key);
    let folder = await repo.findVisibleFolderByName(req, name);
    if (!folder && commit) {
      folder = await repo.createFolder({ name, instituteId: req.requesterInstituteId, createdById: req.user.id });
    }
    // Preview + folder doesn't exist yet: no id to cache/return — existingTitles(null, ...) below
    // is still correct (a not-yet-created folder trivially has no existing questions in it).
    const id = folder?.id || null;
    if (id) folderIdByName.set(key, id);
    return id;
  }

  {
    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const title = field(row, "title");
      const description = field(row, "description");

      if (!title && !description) continue; // blank row
      if (!title) { errors.push({ row: rowNum, reason: "Missing Question Title" }); continue; }
      if (!description) { errors.push({ row: rowNum, reason: "Missing Problem Statement" }); continue; }

      const titleKey = title.toLowerCase();
      if (duplicateAction !== "import" && seenTitles.has(titleKey)) {
        skipped.push({ row: rowNum, reason: `Duplicate title within this file: "${title}"` });
        continue;
      }

      const resolvedSubject = await resolveSubjectUnitTopicByName(req, {
        subjectName: field(row, "subject"), unitName: field(row, "unit"), topicName: field(row, "topic"),
      }, { commit });
      if (resolvedSubject.error) {
        errors.push({ row: rowNum, reason: resolvedSubject.error });
        continue;
      }

      const difficultyRaw = field(row, "difficulty");
      // Same auto-fix-not-block treatment as the quiz importer's identical column — see its own
      // comment for the full rationale (a value like "Confusing" that doesn't recognizably map to
      // Easy/Medium/Hard now falls back to Medium and is logged, rather than rejecting the row).
      if (difficultyRaw && !DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)]) {
        autoFixed.push({ row: rowNum, field: "Difficulty", before: difficultyRaw, after: "Medium (unrecognized value)" });
      }
      const difficulty = DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || (difficultyRaw ? "MEDIUM" : "EASY");

      // Optional image attachment -- same validate-up-front, never-import-as-if-it-existed
      // treatment as the quiz importer's identical block (see its own comment for the full
      // rationale).
      const imageFileNameRaw = field(row, "imageFileName");
      let imageBuffer = null;
      let imageMime = null;
      if (imageFileNameRaw) {
        if (commit && !questionImages.isConfigured()) {
          errors.push({ row: rowNum, reason: "Image storage isn't configured on this server yet — remove the Image File Name or try again later" });
          continue;
        }
        if (!imageZip) {
          errors.push({ row: rowNum, reason: `Image "${imageFileNameRaw}" was referenced but no images ZIP was uploaded alongside this file` });
          continue;
        }
        const basename = imageFileNameRaw.split("/").pop().split("\\").pop();
        const found = imageZip.filesByName.get(basename.toLowerCase());
        const { mime, error: imageError } = validateZipImage(found, imageFileNameRaw);
        if (imageError) {
          errors.push({ row: rowNum, reason: imageError });
          continue;
        }
        imageBuffer = found;
        imageMime = mime;
      }

      const timeLimitSecRaw = field(row, "timeLimitSec");
      const timeLimitSec = timeLimitSecRaw ? Number(timeLimitSecRaw) : 2;
      if (!Number.isFinite(timeLimitSec) || timeLimitSec <= 0) {
        errors.push({ row: rowNum, reason: `Invalid Time Limit "${timeLimitSecRaw}"` });
        continue;
      }

      const memoryLimitMbRaw = field(row, "memoryLimitMb");
      let memoryLimitKb = null;
      if (memoryLimitMbRaw) {
        const mb = Number(memoryLimitMbRaw);
        if (!Number.isFinite(mb) || mb <= 0) {
          errors.push({ row: rowNum, reason: `Invalid Memory Limit "${memoryLimitMbRaw}"` });
          continue;
        }
        memoryLimitKb = Math.round(mb * 1024);
      }

      const languagesRaw = field(row, "languages");
      const requestedLanguages = languagesRaw.split(/[,|]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const unsupported = requestedLanguages.filter((l) => !LANGUAGE_ALIASES[l]);
      if (requestedLanguages.length > 0 && unsupported.length === requestedLanguages.length) {
        errors.push({ row: rowNum, reason: `Unsupported language(s): ${unsupported.join(", ")}` });
        continue;
      }

      const sample1In = field(row, "sampleInput1"), sample1Out = field(row, "sampleOutput1");
      const sample2In = field(row, "sampleInput2"), sample2Out = field(row, "sampleOutput2");
      if (!sample1In || !sample1Out || !sample2In || !sample2Out) {
        errors.push({ row: rowNum, reason: "Each coding question needs 2 complete sample test cases (input + output)" });
        continue;
      }
      const hiddenCases = parseHiddenTestCases(field(row, "hiddenTestCases"));
      if (hiddenCases.length < 5) {
        errors.push({ row: rowNum, reason: `Needs at least 5 hidden test cases — found ${hiddenCases.length} (check the "input->output||input->output" format)` });
        continue;
      }

      const starterCodeByLanguage = {};
      const javaCode = field(row, "starterJava");
      const pyCode = field(row, "starterPython");
      const cppCode = field(row, "starterCpp");
      const cCode = field(row, "starterC");
      if (javaCode) starterCodeByLanguage.java = javaCode;
      if (pyCode) starterCodeByLanguage.python = pyCode;
      if (cppCode) starterCodeByLanguage.cpp = cppCode;
      if (cCode) starterCodeByLanguage.c = cCode;
      // The Programming Languages column previously only validated that the text was recognizable
      // and then discarded it — the declared list now actually filters which starter-code columns
      // get saved, so an admin's language selection has a real effect instead of silently doing
      // nothing while whatever starter-code columns happened to be filled in got saved regardless.
      if (requestedLanguages.length > 0) {
        const canonical = new Set(requestedLanguages.map((l) => LANGUAGE_ALIASES[l]).filter(Boolean));
        for (const lang of Object.keys(starterCodeByLanguage)) {
          if (!canonical.has(lang)) delete starterCodeByLanguage[lang];
        }
      }

      const tags = field(row, "tags").split(",").map((s) => s.trim()).filter(Boolean);
      const bankName = field(row, "questionBank");

      // "Function" mode: resolveCodingFields() validates the signature and auto-generates starter
      // code for every language it supports, overriding whatever the Starter Code columns held —
      // same guarantee CreateQuestion.jsx's admin form relies on, so a bulk-imported FUNCTION
      // question can never drift from what its own signature actually produces.
      const evaluationModeRaw = normalizeHeader(field(row, "evaluationMode"));
      const isFunctionMode = evaluationModeRaw === "function" || evaluationModeRaw === "functionbased";
      let functionSignature = null;
      if (isFunctionMode) {
        const paramsRaw = field(row, "functionParams");
        const params = paramsRaw
          ? paramsRaw.split(",").map((pair) => {
              const [name, type] = pair.split(":").map((s) => (s || "").trim());
              return { name, type };
            })
          : [];
        functionSignature = { methodName: field(row, "functionName"), returnType: field(row, "returnType"), params };
      }

      try {
        const folderId = await resolveBankFolder(bankName);
        const titles = await existingTitles(folderId, resolvedSubject.subjectId, resolvedSubject.unitId, resolvedSubject.unitIsNew);
        if (duplicateAction !== "import" && titles.has(titleKey)) {
          skipped.push({ row: rowNum, reason: `A question titled "${title}" already exists under that Subject/Unit` });
          continue;
        }

        const resolved = resolveCodingFields({
          evaluationType: isFunctionMode ? "FUNCTION" : "STDIO",
          functionSignature,
          starterCodeByLanguage,
        });
        const btlLevel = parseBtlLevel(field(row, "btl"));

        const data = {
          title,
          topic: field(row, "topic") || null,
          subtopic: field(row, "subtopic") || null,
          subjectId: resolvedSubject.subjectId,
          unitId: resolvedSubject.unitId,
          topicId: resolvedSubject.topicId,
          description,
          questionType: "CODING",
          difficulty,
          btlLevel,
          points: Number(field(row, "points")) || 10,
          timeLimitMs: Math.round(timeLimitSec * 1000),
          memoryLimitKb,
          evaluationType: resolved.evaluationType,
          functionSignature: resolved.functionSignature,
          starterCode: Object.values(resolved.starterCodeByLanguage || starterCodeByLanguage)[0] || "",
          starterCodeByLanguage: Object.keys(resolved.starterCodeByLanguage || starterCodeByLanguage).length > 0 ? (resolved.starterCodeByLanguage || starterCodeByLanguage) : undefined,
          tags: tags.length > 0 ? tags : undefined,
          constraints: field(row, "constraints") || null,
          inputFormat: field(row, "inputFormat") || null,
          outputFormat: field(row, "outputFormat") || null,
          instituteId: req.requesterInstituteId,
          folderId,
          createdById: req.user.id,
          testCases: {
            create: [
              { input: sample1In, expected: sample1Out, isHidden: false, explanation: field(row, "sampleExplanation1") || null },
              { input: sample2In, expected: sample2Out, isHidden: false, explanation: field(row, "sampleExplanation2") || null },
              ...hiddenCases,
            ],
          },
        };
        if (commit) {
          let question = await repo.createQuestionBare(data);
          if (imageBuffer) {
            try {
              const imageKey = await questionImages.uploadQuestionImage(question.id, imageBuffer, imageMime);
              question = await repo.updateQuestionBare(question.id, { imageKey, imageMimeType: imageMime });
            } catch (imgErr) {
              errors.push({ row: rowNum, reason: `Question created, but its image failed to upload: ${safeErrorMessage(imgErr, "unknown error")}` });
            }
          }
          created.push(question);
        } else {
          created.push({ row: rowNum, title, description, difficulty, btlLevel, hasImage: !!imageBuffer });
        }
        seenTitles.add(titleKey);
        titles.add(titleKey);
      } catch (err) {
        errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
      }
    }
  }

  if (commit && created.length > 0) {
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { count: created.length, coding: true },
    });
  }
  const validRows = commit ? undefined : created.map((c) => rows[c.row - 2]);
  return {
    total: rows.length, createdCount: created.length, skippedCount: skipped.length, errorCount: errors.length,
    skipped, errors, created, validRows, unknownColumns,
    autoFixedCount: autoFixed.length, autoFixed,
    imagesValidatedCount: created.filter((c) => c.hasImage || c.imageKey).length,
  };
}

// ---------------------------------------------------------------- the routes' own steps
// An error a service answers with: 400 for a file or payload problem, 403 for a folder outside the requester's institute.
async function resolveFolderForBulkImport(req, folderId) {
  if (!folderId) return null;
  const folder = await repo.findFolder(folderId);
  if (!folder || !ownsQuestionRow(req, folder)) throw new ServiceError(403, "That folder isn't in your institute's question bank");
  return folderId;
}
const duplicateActionOf = (body) => (body.duplicateAction === "import" ? "import" : "skip");
function imageZipOf(req) {
  const { imageZip, error } = extractImageZipFromRequest(req);
  if (error) throw new ServiceError(400, error);
  return imageZip;
}
// The confirm routes receive the rows a preview returned: as JSON, or as a string when the request also re-attaches the images ZIP (multipart).
function rowsPayload(raw) {
  try {
    return Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
  } catch {
    throw new ServiceError(400, "Invalid rows payload");
  }
}
const requireOk = (result, prefix = "") => {
  if (result.error) throw new ServiceError(400, `${prefix}${result.error}`);
  return result;
};

// Quiz or coding file import, either committed straight away (the older direct route) or only previewed. Nothing is written when `commit` is false.
async function importFile(req, { coding, commit }) {
  const file = req.files?.file?.[0];
  if (!file) throw new ServiceError(400, "No file uploaded");
  const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
  const { rows, error } = parseUploadedFile(file, { coding });
  if (error) throw new ServiceError(400, error);
  if (rows.length === 0) throw new ServiceError(400, "The uploaded file has no data rows.");
  const imageZip = imageZipOf(req);
  const duplicateAction = duplicateActionOf(req.body);
  return requireOk(coding
    ? await runCodingBulkImport(req, { rows, defaultFolderId: folderId, duplicateAction, imageZip }, commit)
    : await runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, commit));
}

// Confirm: creates the rows a preview returned, re-running every check against current state (never trusting the preview's snapshot).
async function confirmRows(req, { coding }) {
  const rows = rowsPayload(req.body.rows);
  if (!Array.isArray(rows) || rows.length === 0) throw new ServiceError(400, "No rows to import");
  const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
  const imageZip = imageZipOf(req);
  const duplicateAction = duplicateActionOf(req.body);
  return requireOk(coding
    ? await runCodingBulkImport(req, { rows, defaultFolderId: folderId, duplicateAction, imageZip }, true)
    : await runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, true));
}

// ---- combined: one upload, both sheets. Without it a Combined-Template file had to be uploaded twice, and nothing told staff the file had a second sheet.
async function previewCombined(req) {
  const file = req.files?.file?.[0];
  if (!file) throw new ServiceError(400, "No file uploaded");
  const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
  const { mcqRows, codingRows, error } = parseUploadedFileBothSheets(file);
  if (error) throw new ServiceError(400, error);
  if (mcqRows.length === 0 && codingRows.length === 0) throw new ServiceError(400, "The uploaded file has no data rows in either sheet.");
  const imageZip = imageZipOf(req);
  const duplicateAction = duplicateActionOf(req.body);
  // A preview only reads, so both halves can run together. They share the one uploaded images ZIP.
  const [mcqResult, codingResult] = await Promise.all([
    mcqRows.length ? runQuizBulkImport(req, { rows: mcqRows, folderId, duplicateAction, imageZip }, false) : EMPTY_BULK_RESULT,
    codingRows.length ? runCodingBulkImport(req, { rows: codingRows, defaultFolderId: folderId, duplicateAction, imageZip }, false) : EMPTY_BULK_RESULT,
  ]);
  requireOk(mcqResult, "MCQ sheet: ");
  requireOk(codingResult, "CODING sheet: ");
  return {
    total: mcqResult.total + codingResult.total,
    createdCount: mcqResult.createdCount + codingResult.createdCount,
    skippedCount: mcqResult.skippedCount + codingResult.skippedCount,
    errorCount: mcqResult.errorCount + codingResult.errorCount,
    mcqCount: mcqResult.createdCount,
    codingCount: codingResult.createdCount,
    errors: [...tagSheet(mcqResult.errors, "MCQ"), ...tagSheet(codingResult.errors, "Coding")],
    skipped: [...tagSheet(mcqResult.skipped, "MCQ"), ...tagSheet(codingResult.skipped, "Coding")],
    structureHint: mcqResult.structureHint || null,
    autoFixedCount: (mcqResult.autoFixedCount || 0) + (codingResult.autoFixedCount || 0),
    // tagSheet assumes a `.reason`, which auto-fix entries do not have (they carry field, before and after), so those are tagged through the field label instead.
    autoFixed: [
      ...(mcqResult.autoFixed || []).map((f) => ({ ...f, field: `[MCQ] ${f.field}` })),
      ...(codingResult.autoFixed || []).map((f) => ({ ...f, field: `[Coding] ${f.field}` })),
    ],
    unknownColumns: [...new Set([...(mcqResult.unknownColumns || []), ...(codingResult.unknownColumns || [])])],
    imagesValidatedCount: (mcqResult.imagesValidatedCount || 0) + (codingResult.imagesValidatedCount || 0),
    // Kept apart so a confirm can route each half back through the import that knows how to create that kind of question.
    mcqValidRows: mcqResult.validRows || [],
    codingValidRows: codingResult.validRows || [],
  };
}

async function confirmCombined(req) {
  let mcqRows = rowsPayload(req.body.mcqRows);
  let codingRows = rowsPayload(req.body.codingRows);
  if (!Array.isArray(mcqRows)) mcqRows = [];
  if (!Array.isArray(codingRows)) codingRows = [];
  if (mcqRows.length === 0 && codingRows.length === 0) throw new ServiceError(400, "No rows to import");
  const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
  const imageZip = imageZipOf(req);
  const duplicateAction = duplicateActionOf(req.body);
  // Sequential: both halves write real rows, and this is a rare, small-volume action.
  const mcqResult = mcqRows.length ? await runQuizBulkImport(req, { rows: mcqRows, folderId, duplicateAction, imageZip }, true) : EMPTY_BULK_RESULT;
  const codingResult = codingRows.length ? await runCodingBulkImport(req, { rows: codingRows, defaultFolderId: folderId, duplicateAction, imageZip }, true) : EMPTY_BULK_RESULT;
  requireOk(mcqResult, "MCQ sheet: ");
  requireOk(codingResult, "CODING sheet: ");
  return {
    total: mcqResult.total + codingResult.total,
    createdCount: mcqResult.createdCount + codingResult.createdCount,
    skippedCount: mcqResult.skippedCount + codingResult.skippedCount,
    errorCount: mcqResult.errorCount + codingResult.errorCount,
    mcqCount: mcqResult.createdCount,
    codingCount: codingResult.createdCount,
    created: [...(mcqResult.created || []), ...(codingResult.created || [])],
    skipped: [...tagSheet(mcqResult.skipped, "MCQ"), ...tagSheet(codingResult.skipped, "Coding")],
    errors: [...tagSheet(mcqResult.errors, "MCQ"), ...tagSheet(codingResult.errors, "Coding")],
  };
}

module.exports = { importFile, confirmRows, previewCombined, confirmCombined };
