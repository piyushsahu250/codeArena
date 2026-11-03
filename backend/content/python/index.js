"use strict";
// Registry of authored modules in teaching order. Add a module file here once it passes validation.
const modules = [require("./m01"), require("./m02"), require("./m03"), require("./m04"), require("./m05"), require("./m06"), require("./m07"), require("./m08"), require("./m09"), require("./m10"), require("./m11"), require("./m12"), require("./m13"), require("./m14"), require("./m15"), require("./m16"), require("./m17"), require("./m18"), require("./m19"), require("./m20"), require("./p06"), require("./m21"), require("./m22"), require("./m23")];
// The final practice test of every module that has enough questions (see moduleTest.js).
require("./moduleTest").withModuleTests(modules);
module.exports = { modules };
