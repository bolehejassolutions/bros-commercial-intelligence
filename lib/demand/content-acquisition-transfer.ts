import { reviewContentDemandLandingLabels, type LineageProposal } from "../portfolio/content-demand-lineage.mjs";
import { issueDemandAcquisitionTransfer, type DemandAcquisitionScope } from "./first-party-acquisition.ts";

const reject = (): never => { throw Error("BROS_DEMAND_CONTENT_ACQUISITION_REJECTED"); };
const storefront = "https://bros.bolehejas.com";

/**
 * The SELL server supplies the landing URL and consent. The proposal comes
 * from BCI's tenant-scoped storage. This candidate issues no checkout request.
 */
export function issueContentDemandAcquisitionTransfer(
  input: Readonly<{
    scope: DemandAcquisitionScope;
    proposal: LineageProposal;
    landingUrl: string;
    consent: "granted";
    now: string;
    ttlSeconds: number;
  }>,
  serverKey: Uint8Array,
) {
  try {
    const { scope, proposal, landingUrl, consent, now, ttlSeconds } = input;
    if (consent !== "granted" || typeof landingUrl !== "string" || landingUrl.length > 2048) return reject();
    const observed = new URL(landingUrl);
    if (observed.origin !== storefront || observed.pathname !== "/" ||
        observed.username || observed.password || observed.hash) return reject();
    const labels = reviewContentDemandLandingLabels(proposal, landingUrl, scope.tenantId);
    if (!labels.labelsMatch) return reject();

    // Compare decoded query pairs, retaining multiplicity and values without
    // concatenation delimiters. The matcher also protects duplicate UTM keys.
    const proposed = new URL(proposal.trackedLandingUrl);
    for (const name of ["fbclid", "ttclid", "igshid"]) {
      if (proposed.searchParams.has(name) || observed.searchParams.getAll(name).length > 1) return reject();
      observed.searchParams.delete(name);
    }
    const pairs = (url: URL) => [...url.searchParams].map(pair => JSON.stringify(pair)).sort();
    if (JSON.stringify(pairs(observed)) !== JSON.stringify(pairs(proposed))) return reject();

    return issueDemandAcquisitionTransfer({
      scope, consent, now, ttlSeconds,
      source: {
        source: proposal.channel,
        medium: "organic_social",
        campaign: proposal.campaignKey,
        contentLineageKey: labels.lineageKey,
      },
    }, serverKey);
  } catch { return reject(); }
}
