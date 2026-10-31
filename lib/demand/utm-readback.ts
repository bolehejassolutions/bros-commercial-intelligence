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
import { createHash } from "node:crypto";
import { proposeDemandPilotUtm } from "./utm-experiment.ts";
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
const validUtc = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const parsed = Date.parse(value);
  // Date.parse may normalize impossible dates (Feb 30) or 24:00 to another
  // day. Never accept such timestamps as a trustworthy report chronology.
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
};
const count = (n: number | null): boolean =>
  n === null || (typeof n === "number" && Number.isSafeInteger(n) && n >= 0);

export function assessDemandUtmReadback(
  proposal: DemandUtmProposal,
  row: DemandGa4UtmRow | null,
): DemandUtmReadback {
  // DEMAND-only fail-closed proposal integrity boundary. The report
  // correlation must never accept caller-forged approval, verified outcome,
  // pricing/attribution or other extra proposal fields, even when its UTM
  // link and proposalId look plausible. Reconstruct the sole allowed
  // canonical, unlaunched proposal; this is NOT provider authentication.
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) fail();
  const canonical = (() => {
    try {
      return proposeDemandPilotUtm({
        experimentId: proposal.experimentId, channel: proposal.channel,
        variant: proposal.variant, landingUrl: "https://bros.bolehejas.com/",
      });
    } catch { return fail(); }
  })();
  const expected = canonical as unknown as Record<string, unknown>;
  const received = proposal as unknown as Record<string, unknown>;
  if (Object.keys(received).length !== Object.keys(expected).length ||
      Object.keys(expected).some(key =>
        !Object.prototype.hasOwnProperty.call(received, key) ||
        received[key] !== expected[key])) fail();
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
  if (!row || typeof row.reportId !== "string" || !ID.test(row.reportId) ||
      typeof row.propertyId !== "string" ||
      !/^properties\/[1-9]\d{0,19}$/.test(row.propertyId) ||
      !validUtc(row.retrievedAt) ||
      typeof row.periodStart !== "string" || typeof row.periodEnd !== "string" ||
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
  // DEMAND_GA4_SNAPSHOT_IDEMPOTENCY_20261027: retrieval time is audit
  // metadata, NOT provider-snapshot identity. Re-reading unchanged report
  // dimensions/metrics must not generate a new candidate key every hour.
  // The reportId is retained as a report-definition/source discriminator;
  // a changed reportId, property, window or metrics yields a distinct key.
  // Null and reported zero remain distinct. This is NOT provider
  // authentication, tenant attestation or durable shared BCI evidence.
  const snapshotDigest = createHash("sha256").update(JSON.stringify([
    proposal.proposalId, row.reportId, row.propertyId,
    row.periodStart, row.periodEnd, row.landingPath,
    row.source, row.medium, row.campaign, row.content,
    row.sessions, row.engagedSessions,
  ])).digest("hex");
  return result("MATCHED_UNATTESTED",
    `demand:utm-candidate:${proposal.proposalId}:sha256:${snapshotDigest}`,
    row.sessions, row.engagedSessions);
}
