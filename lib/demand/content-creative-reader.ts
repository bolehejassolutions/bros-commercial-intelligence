import { createPublicKey, randomBytes, verify, type KeyObject } from "node:crypto";
import { snapshotDemandCreativeRecord } from "./creative-intake.ts";

type Creative = Parameters<typeof snapshotDemandCreativeRecord>[1];
type Scope = Readonly<{ tenantId: string; principalId: string }>;
const endpoint = "https://content-creative-reuse.internal/api/internal/neon-content-creative-reuse";
const id = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/;
const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const deny = (): never => { throw Error("DEMAND_CONTENT_REUSE_UNVERIFIED"); };

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return deny();
  return value as Record<string, unknown>;
}

export function demandContentReusePublicKey(pem: string | undefined): KeyObject | null {
  if (!pem || pem.length > 1024 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)) return null;
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch { return null; }
}

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !time.test(value)) return deny();
  const at = Date.parse(value);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value) return deny();
  return at;
}

async function boundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) return deny();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return deny();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Per-request consumer of the in-process CONTENT reader. Approval replies sign the UTF-8 JSON tuple below,
 * with creative fields in snapshotDemandCreativeRecord order. Each read has a fresh challenge. */
export function createDemandContentCreativeReader(scope: Scope, jwt: string, key: KeyObject,
  read: (request: Request) => Promise<Response>, now = Date.now) {
  let current: { creative: Creative; logoAssetVersionId: string | null } | undefined;
  const deadline = AbortSignal.timeout(25000);
  async function get(view: "approval" | "original", assetId: string, creativeVersion: string, challenge?: string) {
    if (!id.test(assetId) || !id.test(creativeVersion)) return deny();
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ view, assetId, creativeVersion, ...(challenge ? { challenge } : {}) }).toString();
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(8000)]);
    signal.throwIfAborted();
    const response = await read(new Request(url, {
      method: "GET", headers: { Authorization: "Bearer " + jwt }, cache: "no-store", redirect: "error", signal,
    }));
    signal.throwIfAborted();
    return response;
  }
  return {
    async approvedRecordFor(tenantId: string, assetId: string, creativeVersion: string) {
      if (tenantId !== scope.tenantId) return deny();
      const challenge = randomBytes(24).toString("hex");
      const response = await get("approval", assetId, creativeVersion, challenge);
      if (response.headers.get("content-type")?.split(";")[0] !== "application/json") return deny();
      const envelope = record(JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(await boundedBody(response, 8192))), ["payload", "signature"]);
      const p = record(envelope.payload, ["schemaVersion", "product", "purpose", "principalId",
        "challenge", "issuedAt", "expiresAt", "logoAssetVersionId", "creative"]);
      const creative = snapshotDemandCreativeRecord(tenantId, p.creative as Creative);
      const issuedAt = timestamp(p.issuedAt);
      const expiresAt = timestamp(p.expiresAt);
      const at = now();
      const logoAssetVersionId = p.logoAssetVersionId;
      if (!Number.isFinite(at) || p.schemaVersion !== 1 || p.product !== "demand" ||
          p.purpose !== "CREATIVE_REVIEW" || p.principalId !== scope.principalId || p.challenge !== challenge ||
          creative.assetId !== assetId || creative.creativeVersion !== creativeVersion ||
          issuedAt > at + 5000 || at >= expiresAt || expiresAt <= issuedAt || expiresAt - issuedAt > 60000 ||
          (creative.logoEvidence === "NO_LOGO" ? logoAssetVersionId !== null :
            typeof logoAssetVersionId !== "string" || !id.test(logoAssetVersionId)) ||
          typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return deny();
      const signed = JSON.stringify(["BROS_CONTENT_DEMAND_CREATIVE_REVIEW_V1", p.schemaVersion,
        p.product, p.purpose, p.principalId, challenge, p.issuedAt, p.expiresAt, logoAssetVersionId, creative]);
      if (!verify(null, Buffer.from(signed), key, Buffer.from(envelope.signature, "base64url"))) return deny();
      if (current && current.logoAssetVersionId !== logoAssetVersionId) return deny();
      current = { creative, logoAssetVersionId: logoAssetVersionId as string | null };
      return creative;
    },
    async mediaFor(tenantId: string, assetId: string, creativeVersion: string) {
      const expected = current?.creative;
      if (tenantId !== scope.tenantId || expected?.assetId !== assetId ||
          expected.creativeVersion !== creativeVersion) return deny();
      const response = await get("original", assetId, creativeVersion);
      if (response.headers.get("content-type") !== expected.mime) return deny();
      return boundedBody(response, expected.bytes);
    },
    async verifyApproval(creative: Creative) {
      if (!current || JSON.stringify(current.creative) !== JSON.stringify(creative)) return deny();
      return {
        tenantId: scope.tenantId, product: "demand" as const, purpose: "CREATIVE_REVIEW" as const,
        assetId: creative.assetId, creativeVersion: creative.creativeVersion,
        brandInstanceId: creative.brandInstanceId, mediaSha256: creative.sha256,
        approvalEvidenceId: creative.approvalEvidenceId, logoAssetVersionId: current.logoAssetVersionId,
      };
    },
  };
}
