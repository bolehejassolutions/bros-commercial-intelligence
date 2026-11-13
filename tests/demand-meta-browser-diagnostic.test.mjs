import test from "node:test";
import assert from "node:assert/strict";
import { demandMetaBrowserDiagnostic } from "../lib/demand/meta-browser-diagnostic.ts";

test("session failure explains no authorized server request", () => {
  const message = demandMetaBrowserDiagnostic("session");
  assert.match(message, /session validation/);
  assert.match(message, /no server read was attempted/i);
});

test("Neon token failures are distinguished without returning provider data", () => {
  for (const kind of ["provider", "response", "exception"]) {
    const text = demandMetaBrowserDiagnostic("token", kind);
    assert.match(text, /token/i);
    assert.match(text, /no authorized DEMAND API request|no authorized DEMAND API request is confirmed/);
  }
  assert.notEqual(demandMetaBrowserDiagnostic("token", "provider"),
    demandMetaBrowserDiagnostic("token", "response"));
});

test("browser phases distinguish network request, headers and payload", () => {
  const responses = ["request", "headers", "payload"].map(x => demandMetaBrowserDiagnostic(x));
  assert.equal(new Set(responses).size, 3);
  assert.match(responses[0], /sending the authorized request/);
  assert.match(responses[1], /mandatory security headers/);
  assert.match(responses[2], /expected read-only response fields/);
});

test("unexpected stage fails safe and messages contain no secrets or identifiers", () => {
  const all = ["session", "token", "request", "headers", "payload", "invalid"]
    .flatMap(stage => ["provider", "response", "exception", null]
      .map(reason => demandMetaBrowserDiagnostic(stage, reason)));
  for (const text of all) {
    assert.ok(text.length > 20);
    for (const sensitive of ["postgresql://", "Bearer ", "eyJ", "rasymokh@", "act_199777", "Bearer", "PRIVATE KEY"]) {
      assert.equal(text.includes(sensitive), false);
    }
  }
});
