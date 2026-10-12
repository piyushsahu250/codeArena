// Usage: node make-pin.js 2468   -> prints the saltHex:hashHex value for the invigilator_pin_hash managed configuration.
// PBKDF2-HMAC-SHA256, 120000 iterations, 32-byte hash: must match Handshake.PIN_ITERATIONS in the app.
const crypto = require("crypto");
const pin = process.argv[2];
if (!pin || pin.length < 4) { console.error("Give a PIN of at least 4 digits"); process.exit(1); }
const salt = crypto.randomBytes(16);
console.log(`${salt.toString("hex")}:${crypto.pbkdf2Sync(pin, salt, 120000, 32, "sha256").toString("hex")}`);
