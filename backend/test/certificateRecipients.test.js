const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STAFF_RECIPIENT_ROLES, checkRecipient, canRevokeOwn } = require("../src/utils/certificateRecipients");

test("any issuer may give a student a certificate (institute scope is checked by the route)", () => {
  for (const requesterRole of ["SUPER_ADMIN", "ADMIN", "INSTITUTE_ADMIN", "STAFF"]) {
    assert.deepEqual(checkRecipient({ requesterRole, targetRole: "STUDENT" }), { ok: true }, requesterRole);
  }
});

test("only the Super Admin may give a certificate to staff, a clerk or an institute admin", () => {
  assert.deepEqual([...STAFF_RECIPIENT_ROLES], ["STAFF", "CLERK", "INSTITUTE_ADMIN"]);
  for (const targetRole of STAFF_RECIPIENT_ROLES) {
    assert.deepEqual(checkRecipient({ requesterRole: "SUPER_ADMIN", targetRole }), { ok: true }, targetRole);
    for (const requesterRole of ["ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK", "STUDENT"]) {
      const r = checkRecipient({ requesterRole, targetRole });
      assert.equal(r.ok, false, `${requesterRole} -> ${targetRole}`);
      assert.equal(r.status, 403);
      assert.match(r.error, /Super Admin/);
    }
  }
});

test("administrators and the Super Admin cannot be given one here, even by the Super Admin", () => {
  for (const targetRole of ["ADMIN", "SUPER_ADMIN", "NOBODY", undefined]) {
    const r = checkRecipient({ requesterRole: "SUPER_ADMIN", targetRole });
    assert.equal(r.ok, false, String(targetRole));
    assert.equal(r.status, 400);
  }
});

test("nobody withdraws their own certificate except the Super Admin", () => {
  assert.equal(canRevokeOwn("INSTITUTE_ADMIN", "u1", "u1"), false);
  assert.equal(canRevokeOwn("ADMIN", "u1", "u1"), false);
  assert.equal(canRevokeOwn("INSTITUTE_ADMIN", "u1", "u2"), true);
  assert.equal(canRevokeOwn("SUPER_ADMIN", "u1", "u1"), true);
});
