// Regression test for the browser-voice helpers of the AI interview. Pure functions, no DOM. Run: node frontend/scripts/browserSpeechRegression.mjs
import { isBrowserVoiceSupported, pickEnglishVoice, cleanForSpeech, splitForSpeech, mergeTranscript, describeRecognitionError } from "../src/utils/browserSpeech.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

const full = { webkitSpeechRecognition: function () {}, speechSynthesis: {}, SpeechSynthesisUtterance: function () {} };
check("supported when recognition, synthesis and utterance all exist", isBrowserVoiceSupported(full) === true);
check("unprefixed SpeechRecognition counts", isBrowserVoiceSupported({ ...full, webkitSpeechRecognition: undefined, SpeechRecognition: function () {} }) === true);
check("not supported without recognition (iPhone Safari case)", isBrowserVoiceSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: function () {} }) === false);
check("not supported without synthesis", isBrowserVoiceSupported({ webkitSpeechRecognition: function () {} }) === false);
check("missing window never throws", isBrowserVoiceSupported(undefined) === false && isBrowserVoiceSupported(null) === false);

const v = (lang, name = lang) => ({ lang, name });
check("prefers en-IN over en-US", pickEnglishVoice([v("en-US"), v("en-IN"), v("en-GB")]).lang === "en-IN");
check("then en-GB over en-US", pickEnglishVoice([v("en-US"), v("hi-IN"), v("en-GB")]).lang === "en-GB");
check("accepts underscore locale (Android style en_IN)", pickEnglishVoice([v("hi_IN"), v("en_IN")]).lang === "en_IN");
check("falls back to any English voice", pickEnglishVoice([v("fr-FR"), v("en-AU")]).lang === "en-AU");
check("never picks a non-English voice", pickEnglishVoice([v("hi-IN"), v("fr-FR")]) === null);
check("empty or invalid list returns null", pickEnglishVoice([]) === null && pickEnglishVoice(undefined) === null);

check("markdown markers are removed", cleanForSpeech("**Explain** the `volatile` keyword") === "Explain the volatile keyword");
check("code fences are not read out", !cleanForSpeech("Consider:\n```js\nlet a = 1;\n```\nWhat happens?").includes("let a"));
check("URLs are replaced", cleanForSpeech("See https://example.com/x?y=1 now") === "See link now");
check("null and undefined give an empty string", cleanForSpeech(null) === "" && cleanForSpeech(undefined) === "");

check("a short question is one chunk", splitForSpeech("What is a closure?").length === 1);
check("empty text gives no chunks", splitForSpeech("   ").length === 0);
const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} explains one idea in some detail.`).join(" ");
const chunks = splitForSpeech(long, 120);
check("long text is split into several chunks", chunks.length > 3);
check("no chunk exceeds the limit", chunks.every((c) => c.length <= 120));
check("no words are lost or reordered when splitting", chunks.join(" ").replace(/\s+/g, " ") === cleanForSpeech(long));
const noStops = "word ".repeat(100).trim();
check("text with no sentence stops is still split by words under the limit", splitForSpeech(noStops, 50).every((c) => c.length <= 50));

check("merge adds exactly one space", mergeTranscript("I would use", "a hash map") === "I would use a hash map");
check("merge trims trailing space on the base", mergeTranscript("I would use   ", " a hash map ") === "I would use a hash map");
check("merge into an empty box has no leading space", mergeTranscript("", "hello") === "hello");
check("merging nothing leaves the answer unchanged", mergeTranscript("keep this", "   ") === "keep this" && mergeTranscript(undefined, undefined) === "");

check("no-speech and aborted are not fatal", !describeRecognitionError("no-speech").fatal && !describeRecognitionError("aborted").fatal);
check("permission errors are fatal and mention the microphone", describeRecognitionError("not-allowed").fatal && /Microphone/.test(describeRecognitionError("service-not-allowed").message));
check("network error is fatal and says to type", describeRecognitionError("network").fatal && /Type your answer/.test(describeRecognitionError("network").message));
check("unknown codes are fatal with a typing fallback", describeRecognitionError("something-new").fatal && /Type your answer/.test(describeRecognitionError("something-new").message));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("Browser speech regression: all passed");
