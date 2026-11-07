#!/usr/bin/env node
/**
 * BROS DEMAND — offline, read-only HYPD Meta campaign response replay.
 *
 * Accepts one JSON object on stdin: { scope, query, response }. This tool
 * performs NO network requests, provider writes, DB writes or authentication.
 * The input is caller-supplied and is NEVER an authenticated BCI receipt.
 *
 * Usage: node --experimental-strip-types scripts/demand-hypd-readback.mjs < envelope.json
 * Only a privacy-minimized projection is emitted; no raw provider payload,
 * payer details, tenant ID, access tokens or sourceKey are echoed.
 */
import { readFileSync } from "node:fs";
import { projectHypdMetaCampaignReport } from "../lib/demand/hypd-meta-campaign-report.ts";

const reject = () => {
  process.stderr.write("DEMAND_HYPD_READBACK_REJECTED\n");
  process.exitCode = 2;
};

try {
  const raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 262144) throw new Error("oversized");
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Object.hasOwn(input, "scope") ||
      !Object.hasOwn(input, "query") ||
      !Object.hasOwn(input, "response")) throw new Error("envelope");
  const result = projectHypdMetaCampaignReport(
    input.scope, input.query, input.response,
  );
  const o = result.observation;
  process.stdout.write(JSON.stringify({
    status: result.status,
    identityBinding: result.identityBinding,
    snapshotKey: o?.snapshotKey ?? null,
    campaignId: o?.campaignId ?? null,
    windowStart: o?.windowStart ?? null,
    windowEndInclusive: o?.windowEndInclusive ?? null,
    calendarWindowStatus: o?.calendarWindowStatus ?? null,
    currency: o?.currency ?? null,
    spendMinor: o?.spendMinor ?? null,
    inlineLinkClicks: o?.inlineLinkClicks ?? null,
    landingPageViews: o?.landingPageViews ?? null,
    metaAttributedPurchases: o?.metaAttributedPurchases ?? null,
    pixelPurchaseEvents: o?.pixelPurchaseEvents ?? null,
    actionAliasMismatch: o?.actionAliasMismatch ?? null,
    providerAuthenticationVerified: false,
    tenantAuthorizationVerified: false,
    verifiedPaidOrders: null,
    verifiedCpaMinor: null,
    causalLift: null,
    verifiedOutcome: null,
    recordedLearning: null,
  }) + "\n");
} catch {
  reject();
}
