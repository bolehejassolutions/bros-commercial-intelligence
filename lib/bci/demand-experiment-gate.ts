/** Internal DEMAND experiment evidence gate; never executes ads or asserts causality. */
export type DemandStage = "diagnosis" | "decision" | "action" | "outcome" | "learning";
export type DemandEvidence = Readonly<{
  tenantId: string;
  product: "demand";
  experimentId: string;
  stage: DemandStage;
  sourceKey: string;
  verified: boolean;
  observedAt: string;
  /** Outcome provenance: platform observation is not a confirmed paid order. */
  outcomeClass?: "platform_observation" | "provider_verified";
}>;
export type DemandGate = Readonly<{
  diagnosed: boolean;
  actionDocumented: boolean;
  outcomeVerified: boolean;
  learningDocumented: boolean;
  internalV1EvidenceComplete: boolean;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error("Invalid DEMAND experiment evidence"); };
const stages: readonly DemandStage[] = ["diagnosis","decision","action","outcome","learning"];
/** Caller must verify provider evidence server-side; a boolean is not provider attestation. */
export function evaluateDemandExperiment(tenantId: string, experimentId: string, rows: readonly DemandEvidence[]): DemandGate {
  if (!UUID.test(tenantId) || !experimentId || experimentId.length > 160 ||
      !Array.isArray(rows) || rows.length > 1000) fail();
  const unique = new Map<string,string>();
  const verified = new Map<DemandStage,DemandEvidence>();
  for (const row of rows) {
    if (!row || row.tenantId !== tenantId || row.product !== "demand" ||
        row.experimentId !== experimentId || !stages.includes(row.stage) ||
        typeof row.sourceKey !== "string" || !row.sourceKey.trim() ||
        typeof row.verified !== "boolean" || typeof row.observedAt !== "string" ||
        !Number.isFinite(Date.parse(row.observedAt)) ||
        (row.stage === "outcome"
          ? !["platform_observation","provider_verified"].includes(row.outcomeClass ?? "")
          : row.outcomeClass !== undefined)) fail();
    const key = row.stage + ":" + row.sourceKey;
    const fingerprint = JSON.stringify(row);
    if (unique.has(key)) {
      if (unique.get(key) !== fingerprint) fail();
      continue;
    }
    unique.set(key,fingerprint);
    if (row.verified) {
      if (verified.has(row.stage)) fail();
      verified.set(row.stage,row);
    }
  }
  for (let i=1;i<stages.length;i++) {
    const current=verified.get(stages[i]), prior=verified.get(stages[i-1]);
    if (current && prior && Date.parse(current.observedAt)<Date.parse(prior.observedAt)) fail();
  }
  const diagnosed=verified.has("diagnosis") && verified.has("decision");
  const actionDocumented=diagnosed && verified.has("action");
  const outcome=verified.get("outcome");
  const outcomeVerified=actionDocumented && !!outcome && outcome.outcomeClass==="provider_verified";
  const learningDocumented=outcomeVerified && verified.has("learning");
  return Object.freeze({diagnosed,actionDocumented,outcomeVerified,learningDocumented,
    internalV1EvidenceComplete:learningDocumented});
}
