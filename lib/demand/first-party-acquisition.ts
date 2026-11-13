import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * DEMAND-owned, server-only PREVIEW contract; no provider calls or persistence.
 * Trusted caller supplies authenticated scope/consent/time and a server key.
 * NEVER accept those authorities, the stored record or the key from a browser.
 * Source labels are unverified claims; raw click IDs/URLs/PII are unsupported.
 *
 * BCI must persist the landing record before releasing a ticket, then atomically
 * recheck membership/consent/expiry and consume its ID once before creating a
 * payment request. This pure module cannot prevent replay or attest those checks.
 * Ticket is a short-lived credential: never put it in URLs, logs or evidence.
 * Only the opaque reference may cross to HitPay's reference_number field, after
 * checkout ownership agrees that the field is unused. No storefront URL support
 * is assumed. Signing keys are caller-owned server secrets, never returned here.
 */
export type DemandAcquisitionScope = Readonly<{
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  environment: "preview";
  branch: "feat/demand-direct-meta-readonly-20261031";
}>;
export type DemandAcquisitionSource = Readonly<{
  source?: "facebook" | "instagram" | "tiktok" | "whatsapp";
  medium?: "paid_social" | "organic_social";
  campaign?: string;
  metaAdId?: string;
  /** Server-resolved candidate from the tenant's stored CONTENT → DEMAND proposal. */
  contentLineageKey?: string;
}>;
export type DemandAcquisitionLandingRecord = Readonly<{
  version: "demand-acquisition-v1";
  acquisitionId: string;
  scope: DemandAcquisitionScope;
  consent: "granted";
  issuedAt: string;
  expiresAt: string;
  source: DemandAcquisitionSource | null;
}>;
export type DemandAcquisitionTicket = Readonly<{
  version: "demand-acquisition-transfer-v1";
  acquisitionId: string;
  scope: DemandAcquisitionScope;
  issuedAt: string;
  expiresAt: string;
  landingDigest: string;
  signature: string;
}>;
type TransferInput = Readonly<{
  ticket: DemandAcquisitionTicket;
  /** Load from BCI, never use a browser's copy as trusted stored evidence. */
  landingRecord: DemandAcquisitionLandingRecord;
  scope: DemandAcquisitionScope;
  now: string;
  /** Explicitly unused; refusing replacement protects existing order linkage. */
  existingReferenceNumber: null;
  /** Trusted server-owned checkout adapter; storefront links cannot assert this. */
  checkoutChannel: "api_payment_request";
}>;

const BRANCH = "feat/demand-direct-meta-readonly-20261031";
const VERSION = "demand-acquisition-v1";
const TICKET_VERSION = "demand-acquisition-transfer-v1";
const MAX_TTL_MS = 15 * 60 * 1000;
const ID = /^da1_[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const SCOPE_KEYS = ["tenantId", "product", "pilotProduct", "environment", "branch"];
const RECORD_KEYS = ["version", "acquisitionId", "scope", "consent", "issuedAt", "expiresAt", "source"];
const TICKET_KEYS = ["version", "acquisitionId", "scope", "issuedAt", "expiresAt", "landingDigest", "signature"];
const TRANSFER_KEYS = ["ticket", "landingRecord", "scope", "now", "existingReferenceNumber", "checkoutChannel"];
const invalid = (): never => { throw new Error("BROS_DEMAND_ACQUISITION_TRANSFER_REJECTED"); };
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null) &&
  // JSON data only. Accessors could return different values between validation
  // and MAC construction; hidden properties have no stable JSON representation.
  Reflect.ownKeys(x).every(k => {
    const descriptor = Object.getOwnPropertyDescriptor(x, k);
    return !!descriptor && descriptor.enumerable && Object.hasOwn(descriptor, "value");
  });
const exact = (x: unknown, keys: readonly string[]): x is Record<string, unknown> =>
  object(x) && Reflect.ownKeys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const utc = (x: unknown): x is string => typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;

function scopeValue(x: unknown): DemandAcquisitionScope {
  if (!exact(x, SCOPE_KEYS) || typeof x.tenantId !== "string" || !UUID.test(x.tenantId) ||
      x.product !== "demand" || x.pilotProduct !== "bros_sell" ||
      x.environment !== "preview" || x.branch !== BRANCH) return invalid();
  return Object.freeze({ tenantId: x.tenantId, product: "demand", pilotProduct: "bros_sell",
    environment: "preview", branch: BRANCH });
}
function sourceValue(x: unknown): DemandAcquisitionSource | null {
  if (x === null) return null;
  const allowed = ["source", "medium", "campaign", "metaAdId", "contentLineageKey"];
  if (!object(x) || Reflect.ownKeys(x).length === 0 || Reflect.ownKeys(x).length > allowed.length ||
      Reflect.ownKeys(x).some(k => typeof k !== "string" || !allowed.includes(k))) return invalid();
  const result: { -readonly [K in keyof DemandAcquisitionSource]: DemandAcquisitionSource[K] } = {};
  if (Object.hasOwn(x, "source")) {
    if (!["facebook", "instagram", "tiktok", "whatsapp"].includes(x.source as string)) return invalid();
    result.source = x.source as DemandAcquisitionSource["source"];
  }
  if (Object.hasOwn(x, "medium")) {
    if (!["paid_social", "organic_social"].includes(x.medium as string)) return invalid();
    result.medium = x.medium as DemandAcquisitionSource["medium"];
  }
  if (Object.hasOwn(x, "campaign")) {
    if (typeof x.campaign !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(x.campaign)) return invalid();
    result.campaign = x.campaign;
  }
  if (Object.hasOwn(x, "metaAdId")) {
    if (typeof x.metaAdId !== "string" || !/^[1-9][0-9]{4,24}$/.test(x.metaAdId)) return invalid();
    result.metaAdId = x.metaAdId;
  }
  if (Object.hasOwn(x, "contentLineageKey")) {
    if (typeof x.contentLineageKey !== "string" || !/^content-demand:[a-f0-9]{64}$/.test(x.contentLineageKey) ||
        !result.source || result.source === "whatsapp" || result.medium !== "organic_social" ||
        !result.campaign || result.metaAdId !== undefined) return invalid();
    result.contentLineageKey = x.contentLineageKey;
  }
  return Object.freeze(result);
}
function keyValue(key: unknown): Uint8Array {
  if (!(key instanceof Uint8Array) || key.byteLength < 32 || key.byteLength > 128) return invalid();
  return key;
}
function recordValue(x: unknown): DemandAcquisitionLandingRecord {
  if (!exact(x, RECORD_KEYS) || x.version !== VERSION || typeof x.acquisitionId !== "string" ||
      !ID.test(x.acquisitionId) || x.consent !== "granted" || !utc(x.issuedAt) || !utc(x.expiresAt)) return invalid();
  const duration = Date.parse(x.expiresAt) - Date.parse(x.issuedAt);
  if (duration < 1000 || duration > MAX_TTL_MS) return invalid();
  return Object.freeze({ version: VERSION, acquisitionId: x.acquisitionId,
    scope: scopeValue(x.scope), consent: "granted", issuedAt: x.issuedAt,
    expiresAt: x.expiresAt, source: sourceValue(x.source) });
}
const digestRecord = (record: DemandAcquisitionLandingRecord): string => createHash("sha256")
  .update(JSON.stringify(["bros-demand:landing-record:v1", record])).digest("hex");
const ticketBytes = (ticket: Omit<DemandAcquisitionTicket, "signature">): string =>
  JSON.stringify(["bros-demand:acquisition-transfer:v1", ticket.version, ticket.acquisitionId,
    ticket.scope.tenantId, ticket.scope.product, ticket.scope.pilotProduct,
    ticket.scope.environment, ticket.scope.branch, ticket.issuedAt, ticket.expiresAt, ticket.landingDigest]);
const sign = (ticket: Omit<DemandAcquisitionTicket, "signature">, key: Uint8Array): string =>
  createHmac("sha256", key).update(ticketBytes(ticket)).digest("hex");

/** Scope/consent/time are trusted server inputs; source labels remain unverified. */
export function issueDemandAcquisitionTransfer(
  input: Readonly<{ scope: DemandAcquisitionScope; consent: "granted"; now: string;
    ttlSeconds: number; source: DemandAcquisitionSource | null }>,
  serverKey: Uint8Array,
) {
  try {
    if (!exact(input, ["scope", "consent", "now", "ttlSeconds", "source"]) ||
        input.consent !== "granted" || !utc(input.now) || !Number.isSafeInteger(input.ttlSeconds) ||
        input.ttlSeconds < 1 || input.ttlSeconds > MAX_TTL_MS / 1000) return invalid();
    const key = keyValue(serverKey);
    const record = recordValue({ version: VERSION, acquisitionId: "da1_" + randomBytes(16).toString("hex"),
      scope: input.scope, consent: input.consent, issuedAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + input.ttlSeconds * 1000).toISOString(), source: input.source });
    const unsigned = { version: TICKET_VERSION, acquisitionId: record.acquisitionId,
      scope: record.scope, issuedAt: record.issuedAt, expiresAt: record.expiresAt,
      landingDigest: digestRecord(record) } as const;
    return Object.freeze({ landingRecord: record,
      ticket: Object.freeze({ ...unsigned, signature: sign(unsigned, key) }) });
  } catch { return invalid(); }
}

function validateTransfer(input: TransferInput, serverKey: Uint8Array): DemandAcquisitionLandingRecord {
  if (!exact(input, TRANSFER_KEYS) || input.checkoutChannel !== "api_payment_request" ||
      input.existingReferenceNumber !== null || !utc(input.now)) return invalid();
  const key = keyValue(serverKey);
  const record = recordValue(input.landingRecord);
  const expectedScope = scopeValue(input.scope);
  const ticket = input.ticket;
  if (!exact(ticket, TICKET_KEYS) || ticket.version !== TICKET_VERSION ||
      typeof ticket.signature !== "string" || !HEX.test(ticket.signature) ||
      typeof ticket.landingDigest !== "string" || !HEX.test(ticket.landingDigest)) return invalid();
  const ticketScope = scopeValue(ticket.scope);
  if (JSON.stringify(expectedScope) !== JSON.stringify(record.scope) ||
      JSON.stringify(expectedScope) !== JSON.stringify(ticketScope) ||
      ticket.acquisitionId !== record.acquisitionId || ticket.issuedAt !== record.issuedAt ||
      ticket.expiresAt !== record.expiresAt || ticket.landingDigest !== digestRecord(record) ||
      Date.parse(input.now) < Date.parse(record.issuedAt) || Date.parse(input.now) >= Date.parse(record.expiresAt)) return invalid();
  if (!timingSafeEqual(Buffer.from(ticket.signature, "hex"), Buffer.from(sign(ticket, key), "hex"))) return invalid();
  return record;
}

/** Emits only the merchant reference. It does not consume a ticket or create a payment. */
export function prepareDemandHitPayAcquisitionReference(input: TransferInput, serverKey: Uint8Array) {
  try {
    const record = validateTransfer(input, serverKey);
    return Object.freeze({ reference_number: record.acquisitionId });
  } catch { return invalid(); }
}

/** Project a create/read response to {id, reference_number} before calling.
 * Echo equality is a candidate binding, never authenticated payment proof.
 * BCI must atomically persist a unique tenant/acquisition/request mapping before
 * redirecting, verify provider signature/readback independently, and reject reuse.
 */
export function bindDemandHitPayAcquisitionRequest(
  input: TransferInput,
  paymentRequest: Readonly<{ id: string; reference_number: string }>,
  serverKey: Uint8Array,
) {
  try {
    const record = validateTransfer(input, serverKey);
    if (!exact(paymentRequest, ["id", "reference_number"]) || typeof paymentRequest.id !== "string" ||
        !UUID.test(paymentRequest.id) || paymentRequest.reference_number !== record.acquisitionId) return invalid();
    const candidateKey = "demand:acquisition-request-candidate:sha256:" + createHash("sha256")
      .update(JSON.stringify(["v1", record.scope, record.acquisitionId, paymentRequest.id])).digest("hex");
    return Object.freeze({ status: "REFERENCE_ECHO_MATCHED_UNATTESTED" as const, candidateKey,
      acquisitionId: record.acquisitionId, paymentRequestId: paymentRequest.id,
      ...(record.source?.contentLineageKey ? { contentLineageKey: record.source.contentLineageKey } : {}),
      providerAuthenticationVerified: false as const, tenantAuthorizationVerified: false as const,
      consentVerified: false as const, replayPrevented: false as const,
      bciPersistenceVerified: false as const, hitpayPaymentVerified: false as const,
      acquisitionAttributionVerified: false as const, verifiedPaidOrders: null,
      verifiedCpaMinor: null, verifiedCacMinor: null, verifiedRoas: null, causalLift: null });
  } catch { return invalid(); }
}
