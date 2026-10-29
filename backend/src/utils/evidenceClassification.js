// What a logged proctoring event can honestly be called, decided on the SERVER from the event type and how often it has recurred on the attempt.
// This is a labelling layer for reviewers. It does not change what is penalised or when an attempt is submitted (that stays in proctoringSeverity.js).
//
// Classes, weakest to strongest:
//   OBSERVED_EVENT        a raw browser event was received. Says nothing about intent.
//   SUSPECTED_ACTIVITY    the pattern warrants a human look. Still not misconduct.
//   POLICY_VIOLATION      objective, server-verifiable breach of a documented rule (e.g. a refused start). No browser-reported type reaches it.
//   CONFIRMED_POLICY_VIOLATION  the server found that an action prohibited by the exam's PUBLISHED rules (utils/proctoringPolicy.js) was directly observed. A finding under that rule,
//                         not proof of intent or of external-assistant use. Needs a rule, the matching policy switch and a directly observed event; never client-supplied.
//   CONFIRMED_VIOLATION   set only by an authorised reviewer with a reason. Never produced automatically from browser signals.
//   INCONCLUSIVE          the browser cannot reliably tell what happened (or the type is unknown).
// A web page cannot see other apps, extensions, other devices, OS assistants or what a user looked at, so no browser-only signal may exceed SUSPECTED_ACTIVITY.

const CLASSES = ["OBSERVED_EVENT", "SUSPECTED_ACTIVITY", "POLICY_VIOLATION", "CONFIRMED_POLICY_VIOLATION", "CONFIRMED_VIOLATION", "INCONCLUSIVE"];
const RANK = { INCONCLUSIVE: 0, OBSERVED_EVENT: 1, SUSPECTED_ACTIVITY: 2, POLICY_VIOLATION: 3, CONFIRMED_VIOLATION: 4 };
const AUTOMATIC_CEILING = "SUSPECTED_ACTIVITY";

// category: the five reviewed signal families (or "OTHER"). suspectAfter: the number of occurrences on one attempt at which a pattern is worth a look
// (null = never more than the base class). base: the class of a single occurrence.
const RULES = {
  DRAG_ATTEMPT: { category: "DRAG", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "A drag can be a text selection or the editor moving a selected block. It does not show where content went or that anything was copied." },
  POSSIBLE_EXTERNAL_ASSISTANT: { category: "POSSIBLE_EXTERNAL_ASSISTANCE", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "Means only that the page stayed visible but lost focus. A browser cannot see which app, other device or assistant was involved; notifications, system dialogs and input methods cause the same signal." },
  SPLIT_SCREEN_SUSPECTED: { category: "POSSIBLE_EXTERNAL_ASSISTANCE", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "A window much smaller than the screen. Snapped windows and some keyboards look the same." },
  WINDOW_NOT_FILLING_SCREEN: { category: "POSSIBLE_EXTERNAL_ASSISTANCE", base: "OBSERVED_EVENT", suspectAfter: 2, limits: "The exam window measured smaller than the screen, or moved, for several seconds. A foldable or tablet the operating system put in a window, or a pop-up the system opened, looks the same. It does not show which app was beside the exam or that anything was used." },
  BROWSER_SHORTCUT: { category: "BROWSER_SHORTCUT", base: "OBSERVED_EVENT", suspectAfter: null, limits: "A key combination was pressed. A keydown does not prove the browser or OS action completed, and editors use many of the same combinations." },
  COPILOT_KEY_SIGNAL: { category: "AI_SHORTCUT", base: "OBSERVED_EVENT", suspectAfter: null, limits: "A key the exam rules prohibit reached the page. The operating system may handle such a key before the browser sees it, and the page cannot see whether an assistant opened." },
  AI_SHORTCUT_DETECTED: { category: "AI_SHORTCUT", base: "OBSERVED_EVENT", suspectAfter: null, limits: "A key combination the exam rules prohibit reached the page. It does not show that an assistant opened, which one, or that it was used." },
  PRINT_SCREEN_ATTEMPT: { category: "BROWSER_SHORTCUT", base: "OBSERVED_EVENT", suspectAfter: null, limits: "A Print Screen key press. It does not show that a capture was taken." },
  DEVTOOLS: { category: "DEVTOOLS", base: "INCONCLUSIVE", suspectAfter: 2, limits: "Inferred from the gap between window and page size. Docked panels, snapped windows, zoom and some toolbars produce the same gap; the browser does not report whether DevTools is open." },
  TAB_SWITCH: { category: "TAB_SWITCH", base: "OBSERVED_EVENT", suspectAfter: 2, limits: "The page was hidden past the grace window. A phone call, lock screen, minimise, system dialog or background throttling does the same; the page cannot see which app or content was opened." },
  TAB_SWITCH_BRIEF: { category: "TAB_SWITCH", base: "OBSERVED_EVENT", suspectAfter: null, limits: "A short loss of visibility, usually a notification or system prompt." },
  FULLSCREEN_EXIT: { category: "TAB_SWITCH", base: "OBSERVED_EVENT", suspectAfter: 2, limits: "The browser left fullscreen. Pressing Esc, a system dialog or an on-screen keyboard can do this." },
  CAMERA_DROPPED: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: 2, limits: "The camera stream ended. A permission change, unplugged device or another app taking the camera does the same." },
  MIC_DROPPED: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: 2, limits: "The microphone stream ended. A permission change or device change does the same." },
  COPY: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "A blocked copy attempt. The clipboard is never read." },
  PASTE: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "A blocked paste attempt. The clipboard is never read." },
  CUT: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "A blocked cut attempt." },
  RIGHT_CLICK: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: 3, limits: "A blocked context-menu request." },
  MULTI_MONITOR: { category: "OTHER", base: "INCONCLUSIVE", suspectAfter: 2, limits: "A screen-size heuristic; it cannot see a second display's content." },
  FACE_MISSING: { category: "OTHER", base: "INCONCLUSIVE", suspectAfter: null, limits: "A face was not found in the frame; lighting, posture and camera angle cause this." },
  MULTIPLE_FACES: { category: "OTHER", base: "INCONCLUSIVE", suspectAfter: null, limits: "More than one face was detected; reflections and posters cause this." },
  NETWORK_LOSS: { category: "OTHER", base: "INCONCLUSIVE", suspectAfter: null, limits: "The connection dropped; this is not a student action." },
  REFRESH_ATTEMPT: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: null, limits: "A page reload was attempted." },
  ORIENTATION_CHANGE: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: null, limits: "The device was rotated." },
  NAVIGATION_ATTEMPT: { category: "OTHER", base: "OBSERVED_EVENT", suspectAfter: null, limits: "The browser Back button (or Alt+Left) was pressed during a proctored interview and absorbed by the page. Pressing Back is a common habit and says nothing about outside assistance." },
  SCREEN_OVERLAY_DETECTED: { category: "OTHER", base: "INCONCLUSIVE", suspectAfter: null, limits: "A viewport-size heuristic; an on-screen keyboard or pinch-zoom looks the same." },
};

const UNKNOWN = { category: "OTHER", base: "INCONCLUSIVE", suspectAfter: null, limits: "This event type is not one the platform can interpret." };

// `occurrence` is how many events of this type the attempt has logged up to and including this one.
function evidenceFor(type, occurrence = 1) {
  const rule = RULES[String(type || "").toUpperCase()] || UNKNOWN;
  let classification = rule.base;
  if (rule.suspectAfter && occurrence >= rule.suspectAfter) classification = "SUSPECTED_ACTIVITY";
  if (RANK[classification] > RANK[AUTOMATIC_CEILING]) classification = AUTOMATIC_CEILING; // defensive: the ceiling can never be exceeded automatically
  return {
    category: rule.category, classification, source: "BROWSER", occurrence, limits: rule.limits, confirmed: false,
    rationale: classification === "SUSPECTED_ACTIVITY"
      ? `Seen ${occurrence} times on this attempt; worth a human review. This is not proof of misconduct.`
      : classification === "INCONCLUSIVE" ? "The browser cannot reliably determine what happened." : "A browser event was observed. It says nothing about intent.",
  };
}

// Adds `evidence` to each event of one attempt, in the order given (oldest first), counting recurrences per type.
//
// `policy` is the test's resolved exam policy (utils/testExamSecurity.policyOf). Without it every event keeps the plain evidence classification (never above
// SUSPECTED_ACTIVITY). With it, an event whose type has a PUBLISHED, PROHIBITED rule in utils/proctoringPolicy.js becomes CONFIRMED_POLICY_VIOLATION: a finding
// under that rule, worded as exactly what was observed. The decision uses only the stored type, the stored metadata and the server-side policy; nothing the
// client sent can raise it.
function annotateEvents(events, policy) {
  const { applyPolicy, CONFIRMED, POLICY_VERSION } = require("./proctoringPolicy");
  const seen = {};
  return events.map((e) => {
    seen[e.type] = (seen[e.type] || 0) + 1;
    const base = evidenceFor(e.type, seen[e.type]);
    if (!policy) return { ...e, evidence: base };
    const pol = applyPolicy({ type: e.type, policy, metadata: e.metadata });
    if (!pol) return { ...e, evidence: { ...base, policy: null } };
    const evidence = {
      ...base,
      policy: { version: POLICY_VERSION, ruleId: pol.ruleId, title: pol.title || null, enforcement: pol.enforcement || null, description: pol.description || null, shows: pol.shows || null, doesNotShow: pol.doesNotShow || null, note: pol.note || null },
    };
    if (pol.confirmed) {
      evidence.classification = CONFIRMED;
      evidence.rationale = `A prohibited action was observed: ${pol.description}. This is a finding under the published exam rule "${pol.title}" (policy ${POLICY_VERSION}); it does not show that an assistant or another app was used, or why it happened.`;
    }
    return { ...e, evidence };
  });
}

module.exports = { CLASSES, AUTOMATIC_CEILING, RULES, evidenceFor, annotateEvents };
