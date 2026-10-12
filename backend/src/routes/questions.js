// All /api/questions routes live in modules/questions (authoring, folders, bulk operations, import and export). This file only keeps the mount path stable.
module.exports = require("../modules/questions/questions.routes");
