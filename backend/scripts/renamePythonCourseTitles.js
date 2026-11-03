// One-off, idempotent: bring the already-seeded "Python Zero to Hero" rows in line with the current content files.
//   node scripts/renamePythonCourseTitles.js --plan    print what would change, touch nothing
//   node scripts/renamePythonCourseTitles.js           apply
//
// seedPythonCourse.js only ever creates missing rows (it finds modules by title), so a title changed in the content files would be created
// a second time next to the old one. Run this BEFORE `seedPythonCourse.js --sync` after the titles change in content.
// A module is matched by its stored position (seed writes order = its index in the registry) and is only renamed when its current title is
// the old form of the new one ("Phase N - Module M: Name" -> "Phase N - Name"), so nothing unexpected can be overwritten.
"use strict";
const { modules } = require("../content/python");
const { SLUG, COURSE } = require("./seedPythonCourse");

const plan = process.argv.includes("--plan");
const stripModuleNumber = (title) => title.replace(/^(Phase \d) - Module \d+: /, "$1 - ");

async function main() {
  const prisma = require("../src/prisma");
  const course = await prisma.course.findUnique({ where: { slug: SLUG } });
  if (!course) throw new Error(`course ${SLUG} not found; nothing changed`);
  const rows = await prisma.courseModule.findMany({ where: { courseId: course.id }, orderBy: { order: "asc" } });
  if (rows.length !== modules.length) throw new Error(`expected ${modules.length} modules, found ${rows.length}; nothing changed`);

  const changes = [];
  for (let i = 0; i < modules.length; i++) {
    const want = modules[i].module.title, row = rows.find((r) => r.order === i);
    if (!row) throw new Error(`no module at position ${i}; nothing changed`);
    if (row.title === want) continue;
    if (stripModuleNumber(row.title) !== want) throw new Error(`module ${i + 1} is titled "${row.title}", which is neither the new nor the old form of "${want}"; nothing changed`);
    changes.push({ id: row.id, from: row.title, to: want });
  }
  const courseChange = course.name !== COURSE.name || course.description !== COURSE.description;

  for (const c of changes) console.log(`  module: "${c.from}" -> "${c.to}"`);
  if (courseChange) console.log(`  course: "${course.name}" -> "${COURSE.name}" (and description)`);
  console.log(`${plan ? "Would rename" : "Renaming"} ${changes.length} module(s)${courseChange ? " and update the course name and description" : ""}.`);
  if (plan || (!changes.length && !courseChange)) return;

  await prisma.$transaction([
    ...changes.map((c) => prisma.courseModule.update({ where: { id: c.id }, data: { title: c.to } })),
    ...(courseChange ? [prisma.course.update({ where: { id: course.id }, data: { name: COURSE.name, description: COURSE.description } })] : []),
  ]);
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
