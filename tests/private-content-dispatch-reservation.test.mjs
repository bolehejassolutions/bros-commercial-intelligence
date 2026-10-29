import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateContentDispatchReservation } from "../lib/bci/private-content-dispatch-reservation.ts";
const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const binding = Object.freeze({ reviewPacketId: "review-1", handoffId: "handoff-1",
  signedReviewEvidenceId: "signed-1", planId: "plan-1", mediaSetId: "media-1",
  copySha256: "a".repeat(64), providerOrganizationId: "org-1", channelId: "channel-1" });
const request = { dispatchIntentId: "intent-1", binding };
const grant = { principalId: userId, tenantId, product: "content", active: true };
const approval = { approvalId: "approval-1", dispatchIntentId: "intent-1", tenantId,
  product: "content", status: "approved", approvedBy: userId,
  expiresAt: "2026-11-01T00:00:00.000Z", binding };
const denied = /BCI private dispatch reservation denied/;
function harness(change = {}) {
  const calls = [];
  const deps = { authenticate: async () => ({ userId, authenticated: true }),
    membershipsFor: async () => [grant], loadApproval: async () => approval,
    reserveAtomically: async args => { calls.push(args); return { status: "acquired", reservationId: "res-1" }; },
    now: () => new Date("2026-10-30T00:00:00Z"), ...change };
  return { reserve: createPrivateContentDispatchReservation(deps), calls };
}
test("server-scoped approval yields reservation, never provider SENT", async () => {
  const h = harness(); const r = await h.reserve(request);
  assert.deepEqual(r, { status: "reserved_for_dispatch", reservationId: "res-1",
    dispatchIntentId: "intent-1", providerSent: false, providerAttested: false });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].tenantId, tenantId);
  assert.equal(h.calls[0].product, "content");
  assert.match(h.calls[0].bindingSha256, /^[a-f0-9]{64}$/);
});
test("caller tenant/user/role, altered copy, unexpected binding fail closed", async () => {
  for (const q of [{ ...request, tenantId: other }, { ...request, role: "BROS" },
    { ...request, userId }, { ...request, binding: { ...binding, copySha256: "b".repeat(64) } },
    { ...request, binding: { ...binding, product: "demand" } }]) {
    const h = harness(); await assert.rejects(h.reserve(q), denied);
    assert.equal(h.calls.length, 0);
  }
});
test("revocation, ambiguous membership, expiry, wrong tenant/intent, forged approval fail closed", async () => {
  const cases = [
    { membershipsFor: async () => [] },
    { membershipsFor: async () => [grant, grant] },
    { loadApproval: async () => ({ ...approval, expiresAt: "2026-10-29T00:00:00.000Z" }) },
    { loadApproval: async () => ({ ...approval, tenantId: other }) },
    { loadApproval: async () => ({ ...approval, dispatchIntentId: "another-intent" }) },
    { loadApproval: async () => ({ ...approval, status: "pending" }) },
    { loadApproval: async () => ({ ...approval, binding: { ...binding, mediaSetId: "altered" } }) },
  ];
  for (const change of cases) { const h = harness(change);
    await assert.rejects(h.reserve(request), denied); assert.equal(h.calls.length, 0); }
  let n = 0; const h = harness({ membershipsFor: async () => ++n === 1 ? [grant] : [] });
  await assert.rejects(h.reserve(request), denied); assert.equal(h.calls.length, 0);
});
test("replay and ambiguous provider result cannot silently re-publish", async () => {
  for (const status of ["already_reserved", "denied", "acquired"]) {
    const h = harness({ reserveAtomically: async () => ({ status,
      reservationId: status === "acquired" ? null : "res-1" }) });
    await assert.rejects(h.reserve(request), denied);
  }
  const h = harness({ reserveAtomically: async () => ({ status: "needs_reconciliation", reservationId: null }) });
  assert.deepEqual(await h.reserve(request), { status: "reconciliation_required",
    reservationId: null, dispatchIntentId: "intent-1", providerSent: false, providerAttested: false });
});
test("no DB adapter or unexpected adapter result fails closed", async () => {
  assert.throws(() => createPrivateContentDispatchReservation({}), denied);
  const h = harness({ reserveAtomically: async () => ({ status: "published", reservationId: "res-1" }) });
  await assert.rejects(h.reserve(request), denied);
});
