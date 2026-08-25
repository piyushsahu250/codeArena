// Single source of truth for the 7 InterviewCategory enum values and 4 AptitudeCategory enum
// values — shared by InterviewAdmin.jsx and InterviewDraftReview.jsx so the two admin surfaces
// can never silently drift out of sync with each other or with the backend enum (interview.js's
// own VALID_CATEGORIES constant).
export const CATEGORIES = ["HR", "TECHNICAL", "CODING", "APTITUDE", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];
export const APTITUDE_CATS = ["QUANTITATIVE", "LOGICAL", "VERBAL", "DATA_INTERPRETATION"];
export const PACKAGE_BANDS = ["LPA_3_5", "LPA_5_10", "LPA_10_20", "LPA_20_PLUS"];
export const PACKAGE_BAND_LABEL = { LPA_3_5: "3-5 LPA", LPA_5_10: "5-10 LPA", LPA_10_20: "10-20 LPA", LPA_20_PLUS: "20+ LPA" };
// FRESHER/EXPERIENCED are the two original broad buckets (still valid, still used by generic
// question generation); the rest were added for the Company-Specific Interview Question
// Intelligence System's role/level targeting.
export const EXPERIENCE_LEVELS = ["INTERN", "FRESHER", "ENTRY_LEVEL", "JUNIOR", "MID_LEVEL", "SENIOR", "LEAD", "MANAGER", "EXPERIENCED"];
export const EXPERIENCE_LEVEL_LABEL = {
  INTERN: "Intern", FRESHER: "Fresher", ENTRY_LEVEL: "Entry Level", JUNIOR: "Junior",
  MID_LEVEL: "Mid Level", SENIOR: "Senior", LEAD: "Lead", MANAGER: "Manager", EXPERIENCED: "Experienced",
};
export const FREQUENCY_TAGS = ["FREQUENTLY_ASKED", "RECENTLY_ASKED", "TRENDING", "COMPANY_SPECIFIC"];
export const FREQUENCY_TAG_LABEL = { FREQUENTLY_ASKED: "Frequently Asked", RECENTLY_ASKED: "Recently Asked", TRENDING: "Trending", COMPANY_SPECIFIC: "Company Specific" };

// Company-Specific Interview Question Intelligence System — source/confidence display.
export const SOURCE_TYPE_LABEL = {
  OFFICIAL_COMPANY: "Official company source", CANDIDATE_REPORTED: "Candidate reported",
  PUBLIC_INTERVIEW_REPORT: "Public interview report", CODEARENA_VERIFIED: "CodeArena verified (multiple reports)",
  AI_GENERATED_VARIANT: "AI-generated variant",
};
export const CONFIDENCE_LEVEL_COLOR = { HIGH: "var(--mint)", MEDIUM: "var(--amber, #b8860b)", LOW: "var(--ink-dim)" };
