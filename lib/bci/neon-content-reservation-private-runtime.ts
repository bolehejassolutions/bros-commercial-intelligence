import "server-only";
/**
 * BCI shared-core DEV CONTENT reservation. Server-only runtime shared by the
 * protected DEV HTTP boundary and private callers. No Buffer dispatch,
 * provider SENT or Production enablement.
 * The caller supplies a signed Neon Auth JWT; tenant/principal are never
 * accepted from a request and are derived from authoritative membership.
 */
import { Pool } from "pg";
import { createNeonAuthPrincipalVerifier } from "./neon-auth-principal.ts";
import { createNeonDevMembershipLookup } from "./neon-dev-membership-rows.ts";
import { BciContentAtomicReservationDenied, createPgContentReservationTransaction,
  createPgContentReservationReadTransaction, createPgContentDispatchAtomicReservation,
  type ContentReservationArgs } from "./neon-content-dispatch-atomic.ts";
import { isNeonPreviewEnabled } from "./neon-preview-handler.ts";
import { createPgReadOnlyTransaction, parseNeonDevConnection } from "./neon-readonly-transaction.ts";

const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const issuer = new URL(authBase).origin;
const verify = createNeonAuthPrincipalVerifier({
  issuer, audience: issuer, jwksUrl: `${authBase}/.well-known/jwks.json`,
  approvedOperator: { email: "rasymokh@gmail.com" },
});
type Request = Pick<ContentReservationArgs, "dispatchIntentId" | "approvalId" | "bindingSha256">;
let runtime: ReturnType<typeof createPrivateRuntime> | undefined;
const enabled = () => isNeonPreviewEnabled(process.env) &&
  process.env.BCI_NEON_DEV_CONTENT_RESERVATIONS === "enabled";

function createPrivateRuntime() {
  if (!enabled()) throw new BciContentAtomicReservationDenied();
  // Distinct sensitive exact-branch Preview credentials. No owner/BROS fallback.
  const membership = parseNeonDevConnection(
    process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL, "bci_dev_membership_reader");
  const reservation = parseNeonDevConnection(
    process.env.BCI_NEON_DEV_CONTENT_RESERVER_DATABASE_URL, "bci_dev_content_reserver");
  const pool = (config: ReturnType<typeof parseNeonDevConnection>) => {
    const result = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true, query_timeout: 7000,
      application_name: "bci-private-content-reservation-dev" });
    result.on("error", () => { /* Never log driver exceptions or credentials. */ });
    return result;
  };
  const reservationPool = pool(reservation);
  const reservationTransaction = createPgContentReservationTransaction(reservationPool);
  return {
    membershipsFor: createNeonDevMembershipLookup(createPgReadOnlyTransaction(pool(membership))),
    reserve: createPgContentDispatchAtomicReservation(reservationTransaction),
    recheck: createPgContentDispatchAtomicReservation(reservationTransaction, "predispatch_recheck"),
    readback: createPgContentDispatchAtomicReservation(
      createPgContentReservationReadTransaction(reservationPool), "committed_readback"),
  };
}

/** The reservation HTTP boundary delegates here; neither operation publishes. */
async function performPrivateContentOperation(token: unknown, request: Request,
  action: "reserve" | "recheck") {
  if (!enabled()) throw new BciContentAtomicReservationDenied();
  try {
    if (!request || typeof request !== "object" || Array.isArray(request) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(request)) ||
        Reflect.ownKeys(request).length !== 3 ||
        !["dispatchIntentId","approvalId","bindingSha256"].every(k => {
          const d=Object.getOwnPropertyDescriptor(request,k);
          return d?.enumerable===true && Object.hasOwn(d,"value");
        })) {
      throw new BciContentAtomicReservationDenied();
    }
    // Freeze the caller-owned tuple before JWT/network awaits.
    const pinned = Object.freeze({ dispatchIntentId:request.dispatchIntentId,
      approvalId:request.approvalId,bindingSha256:request.bindingSha256 });
    const principal = await verify(token);
    runtime ??= createPrivateRuntime();
    const grants = await runtime.membershipsFor(principal.userId, "content");
    if (grants.length !== 1 || grants[0].principalId !== principal.userId ||
        grants[0].product !== "content" || grants[0].active !== true) {
      throw new BciContentAtomicReservationDenied();
    }
    // SQL transaction independently rechecks active membership, approval,
    // expiry, revocation, role posture and unique dispatch intent.
    const args = { ...pinned, tenantId: grants[0].tenantId,
      principalId: principal.userId, product: "content" as const };
    if (action === "recheck") return await runtime.recheck(args);
    const result = await runtime.reserve(args);
    // A new physical READ ONLY transaction starts after reservation COMMIT.
    // It verifies storage without invoking INSERT triggers or repairing rows.
    const readback = await runtime.readback(args);
    if (result.status === "acquired" && readback.reservationId !== result.reservationId)
      throw new BciContentAtomicReservationDenied();
    const finalPrincipal = await verify(token);
    const fresh = await runtime.membershipsFor(finalPrincipal.userId,"content");
    if (finalPrincipal.userId !== principal.userId || fresh.length !== 1 ||
        fresh[0].principalId !== principal.userId || fresh[0].tenantId !== args.tenantId ||
        fresh[0].product !== "content" || fresh[0].active !== true)
      throw new BciContentAtomicReservationDenied();
    return result;
  } catch {
    throw new BciContentAtomicReservationDenied();
  }
}

/** A fresh server-side check, NOT authorization to publish or evidence of SENT.
 * Keep CONTENT dispatch held until trusted approval issuance and provider
 * idempotency/outcome audit are independently verified. */
export async function recheckNeonDevContentBeforeDispatchPrivately(token: unknown, request: Request) {
  return performPrivateContentOperation(token, request, "recheck");
}

export async function reserveNeonDevContentPrivately(token: unknown, request: Request) {
  const result=await performPrivateContentOperation(token, request, "reserve");
  if(result.status!=="acquired"&&result.status!=="already_reserved")
    throw new BciContentAtomicReservationDenied();
  return result;
}

