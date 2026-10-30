const { test } = require("node:test");
const assert = require("node:assert/strict");
const { certificateOffered, parseCertificateEnabled } = require("../src/utils/courseCertificatePolicy");

test("a course issues certificates unless it was switched off; an older row without the flag still does", () => {
  assert.equal(certificateOffered({ certificateEnabled: true }, null), true);
  assert.equal(certificateOffered({}, null), true);
  assert.equal(certificateOffered({ certificateEnabled: undefined }, null), true);
  assert.equal(certificateOffered({ certificateEnabled: false }, null), false);
});

test("switching a course off never takes away a certificate a student already holds", () => {
  assert.equal(certificateOffered({ certificateEnabled: false }, { id: "cert-1", status: "VALID" }), true);
  assert.equal(certificateOffered({ certificateEnabled: true }, { id: "cert-1" }), true);
});

test("the flag is read as a real boolean; anything unclear changes nothing", () => {
  assert.equal(parseCertificateEnabled(true), true);
  assert.equal(parseCertificateEnabled(false), false);
  assert.equal(parseCertificateEnabled("true"), true);
  assert.equal(parseCertificateEnabled("false"), false);
  assert.equal(parseCertificateEnabled(undefined), undefined);
  assert.equal(parseCertificateEnabled(null), undefined);
  assert.equal(parseCertificateEnabled(""), undefined);
  assert.equal(parseCertificateEnabled("no"), undefined);
  assert.equal(parseCertificateEnabled(0), undefined);
});
