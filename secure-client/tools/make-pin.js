// node tools/make-pin.js <pin>  -> prints the value for config.json "invigilatorPinHash" (scrypt, random salt)
const crypto = require("crypto");
const pin = process.argv[2];
if (!pin || pin.length < 4) { console.error("usage: node tools/make-pin.js <pin of 4+ characters>"); process.exit(1); }
const salt = crypto.randomBytes(16);
console.log(`${salt.toString("hex")}:${crypto.scryptSync(pin, salt, 32).toString("hex")}`);
