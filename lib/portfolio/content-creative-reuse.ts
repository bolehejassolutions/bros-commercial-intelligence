import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

type Scope = Readonly<{ principalId: string; tenantId: string }>;
type Original = Readonly<{ bytes: Uint8Array; brandInstanceId: unknown }>;
const path = "/api/internal/neon-content-creative-reuse";
const id = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/;
const sha = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const proof = /^content-instance-script-proof-[a-f0-9]{64}$/;
const signature = /^[a-zA-Z0-9_-]{86}$/;
const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
  Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
const denied = (status: number) => Response.json({ error: "CONTENT creative reuse unavailable." }, { status, headers });
const invalid = (): never => { throw Error("CONTENT_CREATIVE_REUSE_DENIED"); };

// Same sorted field order as DEMAND snapshotDemandCreativeRecord.
const fields = ["aiDisclosure", "approvalEvidenceId", "assetId", "brandInstanceId", "bytes", "claimsEvidence",
  "creativeVersion", "editorialQa", "logoEvidence", "mediaQa", "mime", "presetId", "presetVersion", "sha256",
  "status", "tenantId"] as const;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length || !keys.every(key => {
        const field = Object.getOwnPropertyDescriptor(value, key);
        return field?.enumerable && Object.hasOwn(field, "value");
      })) return invalid();
  return value as Record<string, unknown>;
}
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
function instant(value: unknown): number {
  if (!matches(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)) return invalid();
  const at = Date.parse(value);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value) return invalid();
  return at;
}

function activeGrant(raw: unknown, ownerKeys: ReadonlyMap<string, KeyObject>, scope: Scope,
  assetId: string, creativeVersion: string, now: number) {
  const envelope = exact(raw, ["keyId", "payload", "signature"]);
  const p = exact(envelope.payload, ["schemaVersion", "product", "purpose", "proofEnvelopeId", "slot",
    "approvedAt", "expiresAt", "logoAssetVersionId", "creative"]);
  const data = exact(p.creative, fields);
  const creative = Object.fromEntries(fields.map(field => [field, data[field]]));
  const approvedAt = instant(p.approvedAt), expiresAt = instant(p.expiresAt);
  if (!Number.isFinite(now) || p.schemaVersion !== 1 || p.product !== "demand" || p.purpose !== "CREATIVE_REVIEW" ||
      !matches(p.proofEnvelopeId, proof) || typeof p.slot !== "number" || !Number.isInteger(p.slot) ||
      p.slot < 1 || p.slot > 6 || approvedAt > now || expiresAt <= now ||
      expiresAt - approvedAt > 24 * 60 * 60 * 1000 ||
      !matches(scope.principalId, uuid) || !matches(scope.tenantId, uuid) ||
      creative.tenantId !== scope.tenantId || creative.assetId !== assetId || creative.creativeVersion !== creativeVersion ||
      ![creative.brandInstanceId, creative.presetId, creative.presetVersion, creative.approvalEvidenceId]
        .every(value => matches(value, id)) ||
      creative.mime !== "image/png" || typeof creative.bytes !== "number" || !Number.isSafeInteger(creative.bytes) ||
      creative.bytes < 32 || creative.bytes > 12 * 1024 * 1024 || !matches(creative.sha256, sha) ||
      creative.status !== "APPROVED" || creative.editorialQa !== "APPROVED" || creative.mediaQa !== "PASSED" ||
      creative.aiDisclosure !== "REVIEWED" || !["VERIFIED", "NO_CLAIMS"].some(value => value === creative.claimsEvidence) ||
      !(creative.logoEvidence === "NO_LOGO" ? p.logoAssetVersionId === null :
        creative.logoEvidence === "OFFICIAL_APPROVED" && matches(p.logoAssetVersionId, id)) ||
      !matches(envelope.keyId, id) || !matches(envelope.signature, signature)) return invalid();
  const ownerKey = ownerKeys.get(envelope.keyId);
  const signed = JSON.stringify(["BROS_CONTENT_OWNER_DEMAND_REUSE_V1", envelope.keyId, p.schemaVersion, p.product, p.purpose,
    p.proofEnvelopeId, p.slot, p.approvedAt, p.expiresAt, p.logoAssetVersionId, creative]);
  if (ownerKey?.asymmetricKeyType !== "ed25519" ||
      !verify(null, Buffer.from(signed), ownerKey, Buffer.from(envelope.signature, "base64url"))) return invalid();
  return { creative, proofEnvelopeId: p.proofEnvelopeId, slot: p.slot, expiresAt, logoAssetVersionId: p.logoAssetVersionId };
}

export function readCreativeReuseConfiguration(env: NodeJS.ProcessEnv) {
  try {
    const grant = env.BCI_CONTENT_DEMAND_REUSE_GRANT;
    const ownerPems = env.BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS;
    const issuerPem = env.BCI_CONTENT_DEMAND_REUSE_ISSUER_PRIVATE_KEY;
    if (!grant || grant.length > 8192 || !ownerPems || ownerPems.length > 8192 ||
        !issuerPem || issuerPem.length > 1024 || !issuerPem.startsWith("-----BEGIN PRIVATE KEY-----")) return null;
    const issuer = createPrivateKey(issuerPem);
    if (issuer.asymmetricKeyType !== "ed25519") return null;
    const issuerPublicKey = createPublicKey(issuer);
    const keyMap: unknown = JSON.parse(ownerPems);
    if (!keyMap || typeof keyMap !== "object" || Array.isArray(keyMap)) return null;
    const ownerKeys = new Map<string, KeyObject>();
    for (const [keyId, pem] of Object.entries(keyMap)) {
      if (!matches(keyId, id) || typeof pem !== "string" || !pem.startsWith("-----BEGIN PUBLIC KEY-----")) return null;
      const key = createPublicKey(pem);
      if (key.asymmetricKeyType !== "ed25519" || key.equals(issuerPublicKey)) return null;
      ownerKeys.set(keyId, key);
    }
    return { grant: JSON.parse(grant) as unknown, ownerKeys, issuer };
  } catch { return null; }
}

type Dependencies = Readonly<{
  enabled: () => boolean;
  authorize: (jwt: string) => Promise<Scope>;
  configuration: () => ReturnType<typeof readCreativeReuseConfiguration>;
  readOriginal: (scope: Scope, proofId: string, slot: number) => Promise<Original>;
  now: () => number;
}>;

export function createContentCreativeReuseHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return denied(404);
    if (request.method !== "GET") return Response.json({ error: "Method not allowed." },
      { status: 405, headers: { ...headers, Allow: "GET" } });
    const url = new URL(request.url);
    const view = url.searchParams.get("view"), challenge = url.searchParams.get("challenge");
    const assetId = url.searchParams.get("assetId"), creativeVersion = url.searchParams.get("creativeVersion");
    const keys = view === "approval" ? ["view", "assetId", "creativeVersion", "challenge"] : ["view", "assetId", "creativeVersion"];
    if (url.pathname !== path || request.url.length > 2048 || (view !== "original" && view !== "approval") ||
        url.searchParams.size !== keys.length || keys.some(key => url.searchParams.getAll(key).length !== 1) ||
        !matches(assetId, id) || !matches(creativeVersion, id) ||
        (view === "approval" && !matches(challenge, /^[a-f0-9]{48}$/)) ||
        ["x-tenant-id", "x-user-id", "x-role", "x-admin", "x-product", "x-principal-id", "x-bci-tenant-id"]
          .some(key => request.headers.has(key)) || request.headers.has("transfer-encoding") ||
        Number(request.headers.get("content-length") ?? 0) !== 0) return denied(400);
    const auth = request.headers.get("authorization");
    if (!auth || auth.length > 16007 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) return denied(401);
    try {
      request.signal.throwIfAborted();
      const jwt = auth.slice(7);
      const { principalId, tenantId } = await deps.authorize(jwt);
      const scope = { principalId, tenantId };
      const config = deps.configuration();
      if (!config) return denied(404);
      const grant = activeGrant(config.grant, config.ownerKeys, scope, assetId, creativeVersion, deps.now());
      request.signal.throwIfAborted();
      const original = await deps.readOriginal(scope, grant.proofEnvelopeId, grant.slot);
      if (!(original.bytes instanceof Uint8Array) || original.bytes.length !== grant.creative.bytes) return denied(403);
      const bytes = new Uint8Array(original.bytes);
      if (original.brandInstanceId !== grant.creative.brandInstanceId ||
          createHash("sha256").update(bytes).digest("hex") !== grant.creative.sha256) return denied(403);
      request.signal.throwIfAborted();
      const current = await deps.authorize(jwt);
      request.signal.throwIfAborted();
      const now = deps.now();
      const fresh = deps.configuration();
      if (!fresh || current.principalId !== principalId || current.tenantId !== tenantId ||
          !createPublicKey(config.issuer).equals(createPublicKey(fresh.issuer))) return denied(403);
      const confirmed = activeGrant(fresh.grant, fresh.ownerKeys, scope, assetId, creativeVersion, now);
      if (JSON.stringify(confirmed) !== JSON.stringify(grant)) return denied(403);
      if (view === "original") return new Response(bytes, { headers: { ...headers, "Content-Type": "image/png" } });
      const issuedAt = new Date(now).toISOString();
      const expiresAt = new Date(Math.min(now + 60000, grant.expiresAt)).toISOString();
      const payload = { schemaVersion: 1, product: "demand", purpose: "CREATIVE_REVIEW", principalId, challenge,
        issuedAt, expiresAt, logoAssetVersionId: grant.logoAssetVersionId, creative: grant.creative };
      const signed = JSON.stringify(["BROS_CONTENT_DEMAND_CREATIVE_REVIEW_V1", payload.schemaVersion, payload.product,
        payload.purpose, principalId, challenge, issuedAt, expiresAt, payload.logoAssetVersionId, payload.creative]);
      return Response.json({ payload, signature: sign(null, Buffer.from(signed), fresh.issuer).toString("base64url") }, { headers });
    } catch { return denied(403); }
  };
}
