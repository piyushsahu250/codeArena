// Reads the real, runnable files of a major project, so the guide always shows exactly the code that the tests execute.
"use strict";
const fs = require("fs");
const path = require("path");

const read = (id, name) => fs.readFileSync(path.join(__dirname, id, name), "utf8").replace(/\r\n/g, "\n");
const files = (id, names) => Object.fromEntries(names.map((name) => [name, read(id, name)]));

module.exports = { read, files };
