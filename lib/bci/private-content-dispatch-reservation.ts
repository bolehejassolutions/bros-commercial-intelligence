/**
 * BCI-owned private CONTENT dispatch reservation contract (INTERNAL DEV only).
 * NOT a provider dispatch, durable approval store, or database adapter.
 * The server-side adapter MUST atomically recheck approval/membership and
 * enforce unique (tenant_id, product, dispatch_intent_id).
 */
import { createHash } from "node:crypto";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const bindingKeys = ["reviewPacketId", "handoffId", "signedReviewEvidenceId", "planId",
  "mediaSetId", "copySha256", "providerOrganizationId", "channelId"] as const;
export type ContentDispatchBinding = Readonly<Record<(typeof bindingKeys)[number], string>>;
export type ContentDispatchRequest = Readonly<{ dispatchIntentId: string; binding: ContentDispatchBinding }>;
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Membership = Readonly<{ principalId: string; tenantId: string; product: "content"; active: true }>;
type Approval = Readonly<{
  approvalId: string; dispatchIntentId: string; tenantId: string; product: "content"; status: "approved";
  approvedBy: string; expiresAt: string; binding: ContentDispatchBinding;
}>;
type Reservation = Readonly<{
  status: "acquired" | "already_reserved" | "needs_reconciliation" | "denied";
  reservationId: string | null;
}>;
type Dependencies = Readonly<{
  authenticate: () => Promise<Principal | null>;
  membershipsFor: (userId: string) => Promise<readonly Membership[]>;
  loadApproval: (tenantId: string, dispatchIntentId: string) => Promise<Approval | null>;
  /** MUST be one DB transaction with fresh membership/approval checks and
   * UNIQUE intent acquisition. Ambiguous provider outcomes MUST be reconciled
   * rather than authorizing another publish. */
  reserveAtomically: (args: Readonly<{
    tenantId: string; product: "content"; principalId: string;
    dispatchIntentId: string; approvalId: string; bindingSha256: string;
  }>) => Promise<Reservation>;
  now: () => Date;
}>;
export class BciDispatchReservationDenied extends Error {
  constructor() { super("BCI private dispatch reservation denied."); this.name = "BciDispatchReservationDenied"; }
}
const deny = (): never => { throw new BciDispatchReservationDenied(); };
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, fields: readonly string[]): v is Record<string, unknown> =>
  object(v) && Reflect.ownKeys(v).length === fields.length &&
  Reflect.ownKeys(v).every(k => typeof k === "string" && fields.includes(k) &&
    Object.getOwnPropertyDescriptor(v, k)?.enumerable === true &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(v, k), "value"));
const bindingValid = (v: unknown): v is ContentDispatchBinding =>
  exact(v, bindingKeys) && bindingKeys.every(k =>
    typeof v[k] === "string" && (k === "copySha256" ? SHA.test(v[k]) : ID.test(v[k])));
const digest = (b: ContentDispatchBinding): string => createHash("sha256")
  .update(JSON.stringify(bindingKeys.map(k => b[k]))).digest("hex");

/** A reservation receipt is NOT permission to publish automatically and NOT SENT. */
export function createPrivateContentDispatchReservation(deps: Dependencies) {
  if (!deps || typeof deps.authenticate !== "function" ||
      typeof deps.membershipsFor !== "function" || typeof deps.loadApproval !== "function" ||
      typeof deps.reserveAtomically !== "function" || typeof deps.now !== "function") deny();
  return async (request: ContentDispatchRequest): Promise<Readonly<{
    status: "reserved_for_dispatch" | "reconciliation_required";
    reservationId: string | null; dispatchIntentId: string;
    providerSent: false; providerAttested: false;
  }>> => {
    try {
      if (!exact(request, ["dispatchIntentId", "binding"]) ||
          typeof request.dispatchIntentId !== "string" || !ID.test(request.dispatchIntentId) ||
          !bindingValid(request.binding)) deny();
      const principal = await deps.authenticate();
      if (principal === null) return deny();
      if (!exact(principal, ["userId", "authenticated"]) ||
          principal.authenticated !== true || !UUID.test(principal.userId)) deny();
      // Multiple CONTENT tenant memberships are legitimate. Resolve exactly
      // one trusted tenant by its durable approval; never trust a caller tenant.
      const grants = await deps.membershipsFor(principal.userId);
      if (!Array.isArray(grants) || grants.length < 1 || grants.length > 32) deny();
      const seenTenants = new Set<string>();
      for (const g of grants) {
        if (!exact(g, ["principalId", "tenantId", "product", "active"]) ||
            g.principalId !== principal.userId || g.product !== "content" ||
            g.active !== true || !UUID.test(g.tenantId) ||
            seenTenants.has(g.tenantId)) deny();
        seenTenants.add(g.tenantId);
      }
      const candidates = await Promise.all(grants.map(g =>
        deps.loadApproval(g.tenantId, request.dispatchIntentId)));
      // A loader must never return another tenant's approval, even if the
      // principal happens to belong to both tenants.
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (candidate !== null && candidate.tenantId !== grants[i].tenantId) deny();
      }
      // Same intent approved in two authorized tenants is ambiguous: fail closed.
      const found = candidates.filter((a): a is Approval => a !== null);
      if (found.length !== 1) deny();
      const approval = found[0];
      const grant = grants.find(g => g.tenantId === approval.tenantId);
      if (!grant) deny();
      if (!exact(approval, ["approvalId", "dispatchIntentId", "tenantId", "product", "status", "approvedBy", "expiresAt", "binding"]) ||
          typeof approval.approvalId !== "string" || !ID.test(approval.approvalId) ||
          approval.dispatchIntentId !== request.dispatchIntentId ||
          approval.tenantId !== grant.tenantId || approval.product !== "content" ||
          approval.status !== "approved" || !UUID.test(approval.approvedBy) ||
          !bindingValid(approval.binding) || digest(approval.binding) !== digest(request.binding) ||
          typeof approval.expiresAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(approval.expiresAt)) deny();
      const now = deps.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
          !Number.isFinite(Date.parse(approval.expiresAt)) ||
          new Date(approval.expiresAt).toISOString() !== approval.expiresAt ||
          Date.parse(approval.expiresAt) <= now.getTime()) deny();
      // Narrow revocation window; atomic adapter must recheck again.
      const fresh = await deps.membershipsFor(principal.userId);
      if (!Array.isArray(fresh) || fresh.length < 1 || fresh.length > 32) deny();
      const freshTenants = new Set<string>();
      for (const g of fresh) {
        if (!exact(g, ["principalId", "tenantId", "product", "active"]) ||
            g.principalId !== principal.userId || g.product !== "content" ||
            g.active !== true || !UUID.test(g.tenantId) ||
            freshTenants.has(g.tenantId)) deny();
        freshTenants.add(g.tenantId);
      }
      if (!freshTenants.has(grant.tenantId)) deny();
      const result = await deps.reserveAtomically({ tenantId: grant.tenantId, product: "content",
        principalId: principal.userId, dispatchIntentId: request.dispatchIntentId,
        approvalId: approval.approvalId, bindingSha256: digest(request.binding) });
      if (!exact(result, ["status", "reservationId"])) deny();
      if (result.status === "acquired" && typeof result.reservationId === "string" &&
          ID.test(result.reservationId)) return Object.freeze({ status: "reserved_for_dispatch",
          reservationId: result.reservationId, dispatchIntentId: request.dispatchIntentId,
          providerSent: false, providerAttested: false });
      if (result.status === "needs_reconciliation" && result.reservationId === null)
        return Object.freeze({ status: "reconciliation_required", reservationId: null,
          dispatchIntentId: request.dispatchIntentId, providerSent: false, providerAttested: false });
      // Existing reservation never authorizes a second provider publish.
      return deny();
    } catch { return deny(); }
  };
}
