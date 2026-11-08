/**
 * Private Business OS — DEV-only, non-routed backchannel transport.
 *
 * The upstream endpoint MUST be an owner-controlled, authenticated session
 * introspection service which checks session revocation server-side and returns
 * the verified issuer/audience/subject/session/expiry fields. This transport
 * cannot make an untrusted endpoint authoritative. In particular Neon Auth
 * get-session cookie semantics are NOT assumed to accept bearer credentials.
 * No endpoint is supplied by default; no route or credential is provisioned.
 */
import type { TrustedIntrospection, TrustedSession } from "./assistant-evidence-neon-dev-identity.ts";
import { isIP } from "node:net";

export type BackchannelConfig = Readonly<{
  endpoint: string;
  expectedOrigin: string;
  timeoutMs?: number;
}>;
type Transport = typeof fetch;
const MAX_BYTES = 4096;
const MAX_TOKEN = 4096;
const SAFE_TOKEN = /^[A-Za-z0-9._~+/-]+={0,2}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Reject literal IP destinations, private-name endpoints and non-DNS hostnames.
// This is a configuration guard, NOT a substitute for network-level egress
// controls against DNS rebinding or private IPs returned by DNS resolution.
function isAllowedDnsHost(host: string): boolean {
  const name = host.toLowerCase();
  return isIP(name) === 0 && !name.startsWith("[") &&
    name.includes(".") && !name.endsWith(".") &&
    !name.endsWith(".local") && !name.endsWith(".internal") &&
    !name.endsWith(".localhost") && name !== "localhost" &&
    name.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}


export function createBusinessOsDevBackchannel(
  config: BackchannelConfig, transport: Transport = fetch
): TrustedIntrospection {
  if (!config || typeof transport !== "function") throw Error("DEV backchannel unavailable");
  let url: URL, origin: URL;
  try {
    url = new URL(config.endpoint);
    origin = new URL(config.expectedOrigin);
  } catch { throw Error("DEV backchannel unavailable"); }
  if (url.protocol !== "https:" || origin.protocol !== "https:" ||
      url.origin !== origin.origin || origin.pathname !== "/" ||
      origin.search || origin.hash || url.username || url.password ||
      url.search || url.hash || url.pathname === "/" ||
      origin.username || origin.password || origin.port !== "" ||
      !isAllowedDnsHost(url.hostname) || !isAllowedDnsHost(origin.hostname) ||
      !Number.isInteger(config.timeoutMs ?? 3000) ||
      (config.timeoutMs ?? 3000) < 100 || (config.timeoutMs ?? 3000) > 10000) {
    throw Error("DEV backchannel unavailable");
  }
  const timeoutMs = config.timeoutMs ?? 3000;
  return async bearer => {
    if (typeof bearer !== "string" || bearer.length === 0 ||
        bearer.length > MAX_TOKEN || !SAFE_TOKEN.test(bearer)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(url.href, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + bearer,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: "{}",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status !== 200 || response.redirected ||
          response.url !== url.href ||
          response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
      const size = response.headers.get("content-length");
      if (size && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > MAX_BYTES) { await reader.cancel(); return null; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const v = value as Record<string, unknown>;
      if (Object.keys(v).sort().join(",") !==
          "audience,expiresAt,issuer,revoked,sessionId,subjectId") return null;
      if (typeof v.subjectId !== "string" || !UUID.test(v.subjectId) ||
          typeof v.sessionId !== "string" || !SAFE_ID.test(v.sessionId) ||
          typeof v.issuer !== "string" || !v.issuer.startsWith("https://") ||
          typeof v.audience !== "string" || !SAFE_ID.test(v.audience) ||
          typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt)) ||
          v.revoked !== false) return null;
      return Object.freeze(v as TrustedSession);
    } catch { return null; }
    finally { clearTimeout(timer); }
  };
}
