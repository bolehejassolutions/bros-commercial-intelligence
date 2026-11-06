import test from "node:test";
import assert from "node:assert/strict";
import { buildDemandPausedProposal } from "../lib/demand/meta-paused-proposal.ts";
const now = Date.parse("2026-11-07T00:00:00Z");
const plan = () => ({
  id: "demand-test", account_id: "act_1997776120879476",
  name: "BROS SELL | New approved proposal", objective: "SALES" as const,
  primary_text: "Understand the offer", headline: "BROS SELL",
  description: "Sales tools", page_id: "123456789",
  image_hash: "a".repeat(32), pixel_id: "1636131111400103",
  duration_days: 7, budget_cap_myr: 140,
  authorization_expires_at: "2026-11-08T00:00:00Z",
  meta_campaign_id: null, meta_adset_id: null, meta_creative_id: null, meta_ad_id: null,
});
test("valid plan produces deterministic PAUSED-only provider bodies without writing", () => {
  const first = buildDemandPausedProposal(plan(), 140, now);
  const second = buildDemandPausedProposal(plan(), 140, now);
  assert.equal(first.digest, second.digest);
  assert.equal(first.budgetMinor, 14000);
  assert.equal(first.campaign.status, "PAUSED");
  assert.equal(first.adset("123456").status, "PAUSED");
  assert.equal(first.ad("123456", "234567").status, "PAUSED");
  assert.throws(() => first.adset("not-an-id"), /META_VERIFIED_ID_REQUIRED/);
});
test("rejects existing objects, excess budget, expired approval and wrong account", () => {
  assert.throws(() => buildDemandPausedProposal({ ...plan(), meta_campaign_id: "120251158023300697" }, 140, now),
    /EXISTING_META_OBJECTS_CANNOT_BE_RECREATED/);
  assert.throws(() => buildDemandPausedProposal(plan(), 100, now), /portfolio authority/);
  assert.throws(() => buildDemandPausedProposal(plan(), 140, Date.parse("2026-11-09T00:00:00Z")), /expired/);
  assert.throws(() => buildDemandPausedProposal({ ...plan(), account_id: "act_000000000" }, 140, now), /Unapproved ad account/);
});
