/**
 * BROS DEMAND internal pilot: strict, non-executing UTM report correlation.
 *
 * This pure function cannot authenticate a GA4 provider or its tenant. An
 * authenticated, tenant-scoped server adapter must attest the upstream row
 * before anyone can promote this observation into shared BCI evidence.
 * A matched report is NOT a qualified lead, paid order or causal experiment.
 * The candidate correlation key is NOT a tenant-global BCI evidence ID and
 * must never be persisted as such before server-verified tenant scoping.
 */
import type { DemandUtmProposal } from "./utm-experiment.ts";

export type DemandGa4UtmRow = Readonly<{
  reportId: string;
  propertyId: string;
  retrievedAt: string; // strict UTC ISO timestamp
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  landingPath: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  sessions: number | null;
  engagedSessions: number | null;
}>;

export type DemandUtmReadback = Readonly<{
  proposalId: string;
  status: "NO_READBACK" | "REJECTED_SCOPE" | "MATCHED_UNATTESTED";
  candidateReportCorrelationKey: string | null;
  unattestedSessions: number | null;
  unattestedEngagedSessions: number | null;
  providerAuthenticationVerified: false;
  tenantMembershipVerified: false;
  utmCaptureVerified: false;
  checkoutAttributionVerified: false;
  qualifiedLeads: null;
  settledOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
}>;

const ID = /^[A-Za-z0-9_-]{4,96}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const fail = (): never => { throw new Error("Invalid BROS DEMAND UTM readback"); };
const validDate = (value: string): boolean =>
  DATE.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const count = (n: number | null): boolean =>
  n === null || (typeof n === "number" && Number.isSafeInteger(n) && n >= 0);

export function assessDemandUtmReadback(
  proposal: DemandUtmProposal,
  row: DemandGa4UtmRow | null,
): DemandUtmReadback {
  // Never accept a caller-supplied proposal ID independently of its
  // immutable channel/variant/campaign identity. Otherwise two different
  // proposals could collide in downstream idempotency or evidence correlation.
  if (!proposal || proposal.status !== "PROPOSED" ||
      typeof proposal.experimentId !== "string" ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(proposal.experimentId) ||
      !["facebook", "instagram", "tiktok", "whatsapp"].includes(proposal.channel) ||
      (proposal.variant !== "a" && proposal.variant !== "b") ||
      proposal.proposalId !==
        `demand:utm:${proposal.experimentId}:${proposal.channel}:${proposal.variant}` ||
      typeof proposal.taggedUrl !== "string") fail();
  let url: URL;
  try { url = new URL(proposal.taggedUrl); } catch { return fail(); }
  if (url.origin !== "https://bros.bolehejas.com" || url.pathname !== "/" ||
      url.username || url.password || url.hash || url.searchParams.size !== 4 ||
      url.searchParams.get("utm_source") !== proposal.channel ||
      url.searchParams.get("utm_medium") !== "organic_social" ||
      url.searchParams.get("utm_campaign") !== proposal.experimentId ||
      url.searchParams.get("utm_content") !== proposal.variant) fail();
  const result = (status: DemandUtmReadback["status"], evidenceId: string | null,
    sessions: number | null, engaged: number | null): DemandUtmReadback => Object.freeze({
    proposalId: proposal.proposalId,
    status,
    candidateReportCorrelationKey: evidenceId,
    unattestedSessions: sessions,
    unattestedEngagedSessions: engaged,
    providerAuthenticationVerified: false as const,
    tenantMembershipVerified: false as const,
    utmCaptureVerified: false as const,
    checkoutAttributionVerified: false as const,
    qualifiedLeads: null,
    settledOrders: null,
    verifiedCacMinor: null,
    causalLift: null,
  });
  if (row === null) return result("NO_READBACK", null, null, null);
  if (!row || !ID.test(row.reportId) || !/^properties\/[1-9]\d{0,19}$/.test(row.propertyId) ||
      typeof row.retrievedAt !== "string" || !ISO.test(row.retrievedAt) ||
      !Number.isFinite(Date.parse(row.retrievedAt)) ||
      !validDate(row.periodStart) || !validDate(row.periodEnd) ||
      row.periodStart > row.periodEnd ||
      // GA4 reports use the property's MYT calendar, not the UTC date. At 00:05 MYT
      // the UTC timestamp still belongs to the previous day; UTC comparison
      // would falsely reject a legitimate current-day acquisition readback.
      row.periodEnd > new Date(Date.parse(row.retrievedAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) ||
      !count(row.sessions) || !count(row.engagedSessions) ||
      (row.sessions !== null && row.engagedSessions !== null && row.engagedSessions > row.sessions)) fail();
  if (row.landingPath !== "/" ||
      row.source !== proposal.channel || row.medium !== "organic_social" ||
      row.campaign !== proposal.experimentId || row.content !== proposal.variant) {
    return result("REJECTED_SCOPE", null, null, null);
  }
  // Include GA4 property, window, retrieval timestamp and exact reported counts.
  // GA4 can revise historical attribution without changing its report ID;
  // distinct snapshots must not silently overwrite one another. Null is
  // distinct from provider-reported zero. This is still NOT BCI evidence.
  return result("MATCHED_UNATTESTED",
    `demand:utm-candidate:${proposal.proposalId}:${row.propertyId}:${row.periodStart}:${row.periodEnd}:${row.reportId}:${row.retrievedAt}:${row.sessions === null ? 'null' : row.sessions}:${row.engagedSessions === null ? 'null' : row.engagedSessions}`,
    row.sessions, row.engagedSessions);
}
