/** BCI admission for DEMAND's fixed, versioned UNVERIFIED observation.
 * Reuses the existing restricted receipt reader and lineage LOGIN. No new
 * database/table/role, browser-controlled scope, provider call or approval.
 */
import { interpretPersistedDemandMetaSignal } from "../demand/meta-persisted-signal.ts";
import { createAuthenticatedBciLineageWriter, createAuthenticatedBciLineageReadback,
  type LineageTransaction } from "./neon-lineage-writer.ts";
import type { BciLineageProduct } from "./internal-lineage.ts";

type Principal = Readonly<{ userId: string; authenticated: true }>;
type Grant = Readonly<{ principalId: string; tenantId: string; product: BciLineageProduct; active: true }>;
type Source = Parameters<typeof interpretPersistedDemandMetaSignal>[0];
type Dependencies = Readonly<{
  authenticate: () => Promise<Principal | null>;
  membershipsFor: (id: string, product: BciLineageProduct) => Promise<readonly Grant[]>;
  readReceipt: (tenantId: string, principalId: string) => Promise<Source | null>;
  transaction: LineageTransaction;
  readbackTransaction: LineageTransaction;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw Error("BCI_DEMAND_SIGNAL_DENIED"); };
export type DemandSignalResult = Readonly<{
  receiptId: string; signalId: string; signalVersion: "DEMAND_META_OBSERVATION_V1";
  status: "inserted" | "replayed"; stage: "signal"; verification: "unverified";
  sourceSha256: string; postCommitReadback: true; providerAttested: false; actionAuthorized: false;
}>;

export function createAuthenticatedDemandMetaSignal(deps: Dependencies) {
  if (!deps || [deps.authenticate, deps.membershipsFor, deps.readReceipt,
    deps.transaction, deps.readbackTransaction].some(fn => typeof fn !== "function")) deny();
  return async (): Promise<DemandSignalResult> => {
    try {
      const principal = await deps.authenticate();
      if (!principal || principal.authenticated !== true || !uuid.test(principal.userId)) deny();
      const userId = principal.userId;
      const grants = await deps.membershipsFor(userId, "demand");
      if (!Array.isArray(grants) || grants.length !== 1 || grants[0].principalId !== userId ||
          grants[0].product !== "demand" || grants[0].active !== true || !uuid.test(grants[0].tenantId)) deny();
      const tenantId = grants[0].tenantId;
      const source = await deps.readReceipt(tenantId, userId);
      if (!source || source.tenantId !== tenantId) deny();
      const interpretation = interpretPersistedDemandMetaSignal(source);
      const shared = { authenticate: deps.authenticate, membershipsFor: deps.membershipsFor };
      const readback = createAuthenticatedBciLineageReadback({ ...shared,
        transaction: deps.readbackTransaction });
      // Do not recreate or repair a missing accepted evidence root.
      await readback({ product: "demand", records: [interpretation.evidence] });
      const request = { product: "demand" as const,
        records: [interpretation.evidence, interpretation.signal] };
      const result = await createAuthenticatedBciLineageWriter({ ...shared,
        transaction: deps.transaction })(request);
      if (result.insertedIds.some(id => id !== interpretation.signal.id) ||
          !result.replayedIds.includes(interpretation.evidence.id) ||
          result.insertedIds.length + result.replayedIds.length !== 2) deny();
      // This call starts only after the write transaction's COMMIT resolved.
      // Its fresh physical READ ONLY transaction cannot append or repair rows.
      const committed = await readback(request);
      if (committed.insertedIds.length !== 0 || committed.replayedIds.length !== 2 ||
          !committed.replayedIds.includes(interpretation.signal.id)) deny();
      const current = await deps.readReceipt(tenantId, userId);
      if (!current || current.tenantId !== tenantId ||
          interpretPersistedDemandMetaSignal(current).sourceSha256 !== interpretation.sourceSha256) deny();
      // Revalidate identity and live grant after all asynchronous readback work.
      const finalPrincipal = await deps.authenticate();
      const finalGrants = await deps.membershipsFor(userId, "demand");
      if (!finalPrincipal || finalPrincipal.userId !== userId || finalPrincipal.authenticated !== true ||
          finalGrants.length !== 1 || finalGrants[0].principalId !== userId ||
          finalGrants[0].tenantId !== tenantId || finalGrants[0].product !== "demand" ||
          finalGrants[0].active !== true) deny();
      return Object.freeze({ receiptId: interpretation.evidence.id, signalId: interpretation.signal.id,
        signalVersion: interpretation.version, status: result.insertedIds.length === 1 ? "inserted" : "replayed",
        stage: "signal", verification: "unverified", sourceSha256: interpretation.sourceSha256,
        postCommitReadback: true, providerAttested: false, actionAuthorized: false });
    } catch { return deny(); }
  };
}
