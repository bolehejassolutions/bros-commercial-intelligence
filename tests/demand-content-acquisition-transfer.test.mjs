import test from "node:test";
import assert from "node:assert/strict";
import { prepareContentDemandLink } from "../lib/portfolio/content-demand-lineage.mjs";
import { issueContentDemandAcquisitionTransfer } from "../lib/demand/content-acquisition-transfer.ts";
import { prepareDemandHitPayAcquisitionReference, bindDemandHitPayAcquisitionRequest } from "../lib/demand/first-party-acquisition.ts";

const scope = { tenantId: "11111111-1111-4111-8111-111111111111", product: "demand",
  pilotProduct: "bros_sell", environment: "preview", branch: "feat/demand-direct-meta-readonly-20261031" };
const proposalInput = { schemaVersion: 1, tenantId: scope.tenantId, contentPlanId: "content-plan-" + "a".repeat(64),
  creativeSha256: "b".repeat(64), channel: "facebook", campaignKey: "bros_sell_organic_v1",
  landingUrl: "https://bros.bolehejas.com/?ref=content&edition=standard" };
const proposal = prepareContentDemandLink(proposalInput);
const now = "2026-11-13T00:00:00.000Z";
const key = new Uint8Array(32).fill(11);
const input = { scope, proposal, landingUrl: proposal.trackedLandingUrl, consent: "granted", now, ttlSeconds: 300 };

test("CONTENT proposal survives the consented SELL transfer and provider echo as a BCI candidate", () => {
  const issued = issueContentDemandAcquisitionTransfer({
    ...input, landingUrl: proposal.trackedLandingUrl + "&fbclid=synthetic-only",
  }, key);
  assert.equal(issued.landingRecord.source.contentLineageKey, proposal.lineageKey);
  assert.equal(issued.landingRecord.source.campaign, proposal.campaignKey);
  assert.doesNotMatch(JSON.stringify(issued), /synthetic-only|fbclid/);
  assert.ok(!JSON.stringify(issued.ticket).includes(proposal.lineageKey));
  const checkout = { ...issued, scope, now, existingReferenceNumber: null, checkoutChannel: "api_payment_request" };
  const reference = prepareDemandHitPayAcquisitionReference(checkout, key);
  assert.deepEqual(reference, { reference_number: issued.landingRecord.acquisitionId });
  const echo = { id: "22222222-2222-4222-8222-222222222222", ...reference };
  const candidate = bindDemandHitPayAcquisitionRequest(checkout, echo, key);
  assert.equal(candidate.contentLineageKey, proposal.lineageKey);
  assert.equal(candidate.status, "REFERENCE_ECHO_MATCHED_UNATTESTED");
  assert.equal(candidate.hitpayPaymentVerified, false);
  assert.equal(candidate.acquisitionAttributionVerified, false);
  assert.equal(candidate.bciPersistenceVerified, false);
  assert.equal(candidate.verifiedPaidOrders, null);
  assert.deepEqual(bindDemandHitPayAcquisitionRequest(checkout, echo, key), candidate);
  assert.throws(() => prepareDemandHitPayAcquisitionReference({
    ...checkout, landingRecord: { ...issued.landingRecord, source: {
      ...issued.landingRecord.source, contentLineageKey: "content-demand:" + "f".repeat(64),
    } },
  }, key), /ACQUISITION_TRANSFER_REJECTED/);
});

test("foreign scope, changed creative or campaign, ambiguous query and denied consent cannot issue a transfer", () => {
  const anotherCreative = prepareContentDemandLink({ ...proposalInput, creativeSha256: "c".repeat(64) });
  for (const patch of [
    { scope: { ...scope, tenantId: "22222222-2222-4222-8222-222222222222" } },
    { consent: "denied" },
    { proposal: anotherCreative },
    { proposal: { ...proposal, lineageKey: "content-demand:" + "f".repeat(64) } },
    { proposal: { ...proposal, approvalVerified: true } },
    { landingUrl: proposal.trackedLandingUrl.replace("utm_campaign=bros_sell_organic_v1", "utm_campaign=another_campaign") },
    { landingUrl: proposal.trackedLandingUrl + "&utm_content=" + proposal.tracking.utm_content },
    { landingUrl: proposal.trackedLandingUrl + "&fbclid=a&fbclid=b" },
    { landingUrl: proposal.trackedLandingUrl + "&email=person@example.test" },
    { landingUrl: proposal.trackedLandingUrl.replace("ref=content", "ref=content%7C&ref=") },
    { landingUrl: proposal.trackedLandingUrl.replace("bros.bolehejas.com", "example.test") },
    { landingUrl: proposal.trackedLandingUrl.replace("/?", "/other?") },
  ]) assert.throws(() => issueContentDemandAcquisitionTransfer({ ...input, ...patch }, key),
    /BROS_DEMAND_CONTENT_ACQUISITION_REJECTED/);
});
