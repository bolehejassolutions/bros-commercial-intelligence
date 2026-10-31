"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient, type VanillaBetterAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter, type BetterAuthVanillaAdapterInstance } from "@neondatabase/auth/vanilla/adapters";
import { requestNeonPreviewToken } from "@/lib/bci/neon-preview-client-token";

const operatorEmail = "rasymokh@gmail.com";
const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const endpoint = "/api/internal/demand-meta?since=2026-10-01&until=2026-10-30";
let neonClient: VanillaBetterAuthClient | undefined;

function auth(): VanillaBetterAuthClient {
  neonClient ??= createAuthClient<BetterAuthVanillaAdapterInstance>(authBase, {
    adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: "include" } }),
  });
  return neonClient;
}

async function verifiedSession(): Promise<boolean> {
  const { data, error } = await auth().getSession();
  return !error && Boolean(data?.session && data.user?.email === operatorEmail &&
    data.user.emailVerified === true);
}

const probeHeaders = (response: Response): boolean =>
  response.headers.get("cache-control")?.includes("no-store") === true &&
  response.headers.get("vary")?.toLowerCase().includes("authorization") === true &&
  response.headers.get("x-content-type-options") === "nosniff";

type Stage = "loading" | "start" | "code" | "ready";

/**
 * DEMAND-only manual test console. The server decides branch and mode.
 * The Neon Auth JWT is transient and never rendered, persisted or logged.
 * The browser never receives a Meta access token or Neon connection string.
 */
export default function DemandMetaTestClient() {
  const [stage, setStage] = useState<Stage>("loading");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState("Checking Neon Auth session…");

  useEffect(() => {
    let alive = true;
    verifiedSession().then(ok => {
      if (!alive) return;
      setStage(ok ? "ready" : "start");
      setNotice(ok ? "Approved Neon Auth session found." : "Use your approved Neon Auth email to sign in. Supabase BCI login is separate.");
    }).catch(() => {
      if (alive) { setStage("start"); setNotice("Session unavailable. You may request a sign-in code."); }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (cooldown < 1) return;
    const timer = window.setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setNotice("Requesting Neon Auth email code…");
    try {
      const { error } = await auth().emailOtp.sendVerificationOtp({ email: operatorEmail, type: "sign-in" });
      if (error) throw new Error();
      setStage("code");
      setCode("");
      setCooldown(60);
      setNotice("Enter the email code directly here. Never share it in chat.");
    } catch {
      setNotice("Neon Auth sign-in code could not be requested; no session was created.");
    } finally { setBusy(false); }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !/^[0-9]{6}$/.test(code)) return;
    setBusy(true);
    setNotice("Verifying your Neon Auth session…");
    try {
      const { error } = await auth().signIn.emailOtp({ email: operatorEmail, otp: code });
      setCode("");
      if (error || !(await verifiedSession())) throw new Error();
      setStage("ready");
      setNotice("Verified Neon Auth operator session. Checks are manually initiated.");
    } catch {
      setCode("");
      setNotice("Sign-in verification failed. You may request a new code.");
    } finally { setBusy(false); }
  }

  async function checkDenials() {
    if (busy) return;
    setBusy(true);
    setNotice("Running bounded, no-token HTTP denial probes…");
    try {
      const calls = await Promise.all([
        fetch(endpoint, { cache: "no-store", redirect: "error" }),
        fetch(endpoint, { method: "POST", cache: "no-store", redirect: "error" }),
        fetch(endpoint, { headers: { "x-tenant-id": "unauthorized-scope" }, cache: "no-store", redirect: "error" }),
        fetch(endpoint, { headers: { Authorization: "Bearer invalid.token.value" }, cache: "no-store", redirect: "error" }),
      ]);
      const mode = calls[0].status === 404 ? "OFF" : calls[0].status === 401 ? "ENABLED" : "UNKNOWN";
      const expected = mode === "OFF" ? [404, 404, 404, 404] : [401, 405, 400, 403];
      // Invalid-but-shaped JWT can yield a sanitized 403 only after the enable gate.
      const statusesOK = mode !== "UNKNOWN" && calls.every((r, i) => (
        i === 3 && mode === "ENABLED" ? (r.status === 403 || r.status === 401) : r.status === expected[i]
      ));
      const headersOK = calls.every(probeHeaders);
      if (!statusesOK || !headersOK) throw new Error();
      setNotice("PASS — " + mode + " mode. All 4 denial probes and no-store/security headers verified. This does not verify Neon DB or Meta access.");
    } catch {
      setNotice("FAIL — denial checks not independently verified. Do not enable live reads.");
    } finally { setBusy(false); }
  }

  async function checkReadOnly() {
    if (busy) return;
    setBusy(true);
    setNotice("Checking authorized read-only DEMAND API…");
    try {
      if (!(await verifiedSession())) throw new Error();
      // Short-lived JWT remains in the local stack and is not displayed or persisted.
      const jwt = await requestNeonPreviewToken(auth());
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { Authorization: "Bearer " + jwt },
        cache: "no-store", redirect: "error",
      });
      if (!probeHeaders(response)) throw new Error();
      if (response.status === 404) {
        setNotice("Read flag remains OFF (HTTP 404). No Meta provider request was made.");
      } else if (response.status === 403) {
        setNotice("HTTP 403: authorized read could not be established. Neon/Meta credentials remain unverified.");
      } else if (response.status === 200) {
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            !("source" in body) || body.source !== "DIRECT_META_GRAPH_API" ||
            !("status" in body) || (body.status !== "NO_ROWS_NOT_ZERO" &&
              body.status !== "CAMPAIGN_ROW_OBSERVED_UNATTESTED") ||
            !("campaignExecutionAllowed" in body) ||
            body.campaignExecutionAllowed !== false ||
            !("durableBciEvidenceRecorded" in body) ||
            body.durableBciEvidenceRecorded !== false) throw new Error();
        setNotice("HTTP 200 — read-only Meta response: " + body.status +
          ". No verified paid orders, BCI signed evidence, or campaign execution authority is implied.");
      } else {
        setNotice("API returned HTTP " + response.status + "; no success is attested.");
      }
    } catch {
      setNotice("Protected read could not be verified. Do not copy any JWT or secret.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await auth().signOut();
      if (error) throw new Error();
      setStage("start");
      setCode("");
      setNotice("Neon Auth session signed out.");
    } catch {
      setNotice("Sign-out not confirmed.");
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-shell neon-preview-shell">
      <section className="auth-card" aria-labelledby="demand-test-heading">
        <p className="eyebrow">BROS DEMAND · INTERNAL PREVIEW ONLY</p>
        <h1 id="demand-test-heading">Direct Meta read-only verification</h1>
        <p className="sub">This page tests rejection controls and Neon Auth admission. It cannot create or change ads. The server's direct-read feature flag is OFF by default.</p>
        <p className="sub">Vercel Authentication protects the Preview URL. Sign in to Vercel first if prompted. This is separate from Neon Auth email OTP. You can run no-token HTTP rejection checks without a Neon Auth session.</p>
        <p role="status" aria-live="polite">{notice}</p>
        <div className="auth-form">
          <button type="button" disabled={busy || stage === "loading"} onClick={checkDenials}>Run no-token HTTP rejection checks</button>
          {stage === "start" ? (
            <button type="button" disabled={busy || cooldown > 0} onClick={requestCode}>
              {cooldown > 0 ? "Resend in " + cooldown + "s" : "Send Neon Auth sign-in code"}
            </button>
          ) : null}
          {stage === "code" ? (
            <form onSubmit={submitCode} className="auth-form">
              <label htmlFor="demand-otp">Neon Auth email sign-in code</label>
              <input id="demand-otp" type="text" inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" minLength={6} maxLength={6} required
                value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ""))} />
              <button type="submit" disabled={busy || code.length !== 6}>Sign in securely</button>
              <button type="button" disabled={busy || cooldown > 0} onClick={requestCode}>Request another code</button>
            </form>
          ) : null}
          {stage === "ready" ? (
            <>
              <button type="button" disabled={busy} onClick={checkReadOnly}>Check signed JWT + authorized read-only API</button>
              <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
            </>
          ) : null}
        </div>
        <p className="sub">No JWT, code, access token, tenant ID or database password is shown or written to storage. All provider reads require a manual click and are confined to the approved campaign and date window.</p>
      </section>
    </main>
  );
}
