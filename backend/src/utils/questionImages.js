// Storage layer for question-attached images (diagrams/figures/graphs on a Question — see the
// imageKey/imageMimeType schema comment on Question). Backed by a private S3 bucket, never a
// public one: Block Public Access is on for QUESTION_IMAGES_BUCKET, so the only way to actually
// view an image is a presigned GET URL generated here, on demand, per response.
//
// Credentials: this box runs untrusted student-submitted code in Docker containers, and has a
// host-level firewall rule (DOCKER-USER: DROP -> 169.254.169.254) that deliberately blocks every
// container — including this API's own — from reaching the EC2 instance metadata service, to
// stop a malicious submission from exfiltrating the instance role via SSRF. That rule is a real
// security control and was left in place, which means the usual "no static keys, use the
// instance role" approach doesn't reach this process. Instead this uses a dedicated IAM user
// (codearena-question-images) whose access key is scoped to nothing but this one bucket
// (PutObject/GetObject/DeleteObject/ListBucket) and is injected the same way every other secret
// on this platform already is — via SSM Parameter Store -> deploy-backend.sh -> container env —
// never checked into git.
const crypto = require("crypto");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const REGION = process.env.AWS_REGION || "ap-south-1";
const BUCKET = process.env.QUESTION_IMAGES_BUCKET || "";

// Constructed lazily (and only once) so a server started without these env vars set (local dev,
// CI, a preview deploy) still boots cleanly — every exported function below either no-ops or
// throws a normal, catchable error at call time instead of crashing at require() time.
let _client = null;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: REGION,
      credentials: process.env.QUESTION_IMAGES_AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.QUESTION_IMAGES_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.QUESTION_IMAGES_AWS_SECRET_ACCESS_KEY,
          }
        : undefined, // undefined lets the SDK fall back to its default provider chain (local dev with a real ~/.aws profile)
    });
  }
  return _client;
}

function isConfigured() {
  return !!BUCKET;
}

// Canonical MIME -> file extension used when building the S3 key. Deliberately small and
// allowlist-only — anything not in this set is rejected before ever reaching S3 (see
// sniffImageMime below), so this map can never be asked to handle something unexpected.
const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

// Sniffs the real image format from the first bytes of the buffer — never trusts the client-
// supplied MIME type or filename extension, both of which are attacker-controlled. Returns one of
// MIME_EXT's keys, or null if this isn't a recognized image format at all (the upload route
// rejects null outright). This is a magic-byte check, not full image validation — it doesn't
// protect against a malformed-but-correctly-tagged file, but it does stop someone uploading an
// .html/.svg/.php file renamed to picture.png and having it served back with an image content
// type (the classic stored-XSS-via-upload vector).
function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}

// Uploads one question image and returns its S3 key. `mime` must already be one of MIME_EXT's
// keys (the caller sniffs it first) — this function trusts it as-is. The key embeds questionId so
// a bucket listing (an admin/ops action, not exposed to the app) groups images by question, and a
// fresh random filename per upload so re-uploading a replacement image never collides with or
// silently overwrites a still-referenced old key.
async function uploadQuestionImage(questionId, buffer, mime) {
  const ext = MIME_EXT[mime] || "bin";
  const key = `questions/${questionId}/${crypto.randomUUID()}.${ext}`;
  await client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mime,
  }));
  return key;
}

// Best-effort delete — called when an image is replaced or removed, and when a question carrying
// one is deleted. Never throws: an orphaned object in a private bucket is harmless and cheap to
// tolerate, whereas surfacing an S3 hiccup as a 500 on "save my question edit" would not be worth
// the trade.
async function deleteQuestionImage(key) {
  if (!key || !isConfigured()) return;
  try {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error(`[questionImages] failed to delete S3 object ${key}:`, err.message);
  }
}

// Presigned GET URL generation. The signing timestamp is floored to the start of the current
// SIGN_WINDOW_SEC window (not "now") so that every call made within the same window produces a
// byte-identical URL for the same key — otherwise a fresh signature (and therefore a different
// URL string) on every single question-fetch would mean the browser can never cache the <img>,
// even though the underlying image never changes. Expiry is always SIGN_TTL_SEC past that floored
// point, so real remaining validity is somewhere between (SIGN_TTL_SEC - SIGN_WINDOW_SEC) and
// SIGN_TTL_SEC — comfortably longer than any single test attempt, so a URL captured at the start
// of an exam is still good well after it ends.
const SIGN_WINDOW_SEC = 3600; // 1 hour: how often the URL string actually changes
const SIGN_TTL_SEC = 4 * 3600; // 4 hours: real minimum remaining validity for any URL handed out
async function signQuestionImage(key) {
  if (!key || !isConfigured()) return null;
  const flooredMs = Math.floor(Date.now() / (SIGN_WINDOW_SEC * 1000)) * SIGN_WINDOW_SEC * 1000;
  try {
    return await getSignedUrl(
      client(),
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: SIGN_TTL_SEC, signingDate: new Date(flooredMs) }
    );
  } catch (err) {
    console.error(`[questionImages] failed to sign URL for ${key}:`, err.message);
    return null;
  }
}

// Walks an arbitrary question-bearing shape and attaches `imageUrl` next to every `imageKey` it
// finds, in place. Accepts a single Question-shaped object, an array of them, or an array of
// TestQuestion-shaped join rows ({ question: {...} }) — covers every place questions.js/tests.js
// serializes questions for a response. A row with no imageKey (the common case) gets
// imageUrl: null and costs nothing extra (no network call).
async function attachQuestionImageUrls(input) {
  if (!input) return input;
  const rows = Array.isArray(input) ? input : [input];
  await Promise.all(rows.map(async (row) => {
    const q = row && typeof row === "object" && "question" in row ? row.question : row;
    if (q && typeof q === "object" && "imageKey" in q) {
      q.imageUrl = q.imageKey ? await signQuestionImage(q.imageKey) : null;
    }
  }));
  return input;
}

module.exports = {
  isConfigured,
  sniffImageMime,
  uploadQuestionImage,
  deleteQuestionImage,
  signQuestionImage,
  attachQuestionImageUrls,
  MIME_EXT,
};
