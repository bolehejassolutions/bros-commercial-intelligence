"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient, type VanillaBetterAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter, type BetterAuthVanillaAdapterInstance } from "@neondatabase/auth/vanilla/adapters";
import { requestNeonPreviewToken, NeonPreviewTokenUnavailable } from "@/lib/bci/neon-preview-client-token";
import { demandMetaBrowserDiagnostic, type DemandMetaBrowserPhase } from "@/lib/demand/meta-browser-diagnostic";

const operatorEmail = "rasymokh@gmail.com";
const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const endpoint = "/api/internal/demand-meta?since=2026-10-01&until=2026-10-30";
const historicalEndpoint = "/api/internal/demand-meta?cohort=historical_bros_sell_202610&since=2026-10-08&until=2026-10-27";
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
  const [evidenceNotice, setEvidenceNotice] = useState<string | null>(null);

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
        fetch("/api/internal/demand-meta-evidence", { method: "POST", cache: "no-store", redirect: "error" }),
      ]);
      const mode = calls[0].status === 404 ? "OFF" : calls[0].status === 401 ? "ENABLED" : "UNKNOWN";
      const expected = mode === "OFF" ? [404, 404, 404, 404] : [401, 405, 400, 403];
      // Invalid-but-shaped JWT can yield a sanitized 403 only after the enable gate.
      const statusesOK = mode !== "UNKNOWN" && calls.every((r, i) => (
        i === 4 ? (r.status === 401 || r.status === 404) :
        i === 3 && mode === "ENABLED" ? (r.status === 403 || r.status === 401) : r.status === expected[i]
      ));
      const headersOK = calls.every(probeHeaders);
      if (!statusesOK || !headersOK) throw new Error();
      setNotice("PASS — " + mode + " mode. All 5 denial probes and no-store/security headers verified, including the bodyless DEV POST (HTTP " + calls[4].status + "). This does not verify Neon DB or Meta access.");
    } catch {
      setNotice("FAIL — denial checks not independently verified. Do not enable live reads.");
    } finally { setBusy(false); }
  }

  async function checkReadOnly(mode: "pinned" | "historical" = "pinned") {
    if (busy) return;
    setBusy(true);
    setNotice("Checking authorized read-only DEMAND API…");
    let phase: DemandMetaBrowserPhase = "session";
    try {
      if (!(await verifiedSession())) throw new Error();
      // Short-lived JWT remains in the local stack and is not displayed or persisted.
      phase = "token";
      const jwt = await requestNeonPreviewToken(auth());
      phase = "request";
      const response = await fetch(mode === "historical" ? historicalEndpoint : endpoint, {
        method: "GET",
        headers: { Authorization: "Bearer " + jwt },
        cache: "no-store", redirect: "error",
      });
      phase = "headers";
      if (!probeHeaders(response)) throw new Error();
      phase = "payload";
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
        if (mode === "historical" && body.status === "CAMPAIGN_ROW_OBSERVED_UNATTESTED" &&
            (!("report" in body) || !body.report || typeof body.report !== "object" ||
             !("campaignId" in body.report) ||
             body.report.campaignId !== "120250864977630697")) throw new Error();
        // Product-level, observation-only diagnosis of the ACTUAL signed
        // provider response. Never infer paid orders, CPA, causal lift or a
        // durable BCI receipt from Meta actions or a nonempty HTTP response.
        const report = "report" in body ? body.report : null;
        let diagnosis = "Recheck the bounded Meta reporting window; no rows do not prove zero spend or conversions.";
        let measured = "Provider metrics unavailable.";
        if (body.status === "CAMPAIGN_ROW_OBSERVED_UNATTESTED") {
          if (!report || typeof report !== "object" || Array.isArray(report) ||
              !("spendMinor" in report) ||
              !("metaAttributedPurchases" in report) ||
              !("actionAliasMismatch" in report) ||
              !("inlineLinkClicks" in report) ||
              !("landingPageViews" in report)) throw new Error();
          const countOrNull = (x: unknown): x is number | null =>
            x === null || (typeof x === "number" && Number.isSafeInteger(x) && x >= 0);
          if (!countOrNull(report.spendMinor) || !countOrNull(report.metaAttributedPurchases) ||
              !countOrNull(report.inlineLinkClicks) || !countOrNull(report.landingPageViews) ||
              typeof report.actionAliasMismatch !== "boolean") throw new Error();
          const spend = report.spendMinor === null ? "unknown" :
            "MYR " + (report.spendMinor / 100).toFixed(2);
          const purchases = report.actionAliasMismatch ? "ambiguous" :
            report.metaAttributedPurchases === null ? "unknown" :
            String(report.metaAttributedPurchases);
          measured = "Meta-reported spend: " + spend +
            "; Meta-attributed purchase actions: " + purchases + ".";
          diagnosis = report.actionAliasMismatch
            ? "Review conflicting Meta purchase aliases; do not count them as settled orders."
            : (report.metaAttributedPurchases ?? 0) > 0
              ? "Reconcile independently paid HitPay charges and first-party order joins."
              : report.spendMinor === null
                ? "Verify the Meta spend field before acquisition cost analysis."
                : (report.inlineLinkClicks ?? 0) > 0 && report.landingPageViews === null
                  ? "Verify landing-page-view measurement before interpreting click quality."
                  : "Verify first-party acquisition-to-order linkage before attributing sales.";
        }
        setNotice("HTTP 200 — " + (mode === "historical" ? "historical PAUSED BROS SELL" : "pinned ACQ-V2") +
          " Meta read-only response: " + body.status + ". " + measured +
          " Next diagnostic action: " + diagnosis +
          " Provider observations only; no HitPay attribution, BCI signed evidence, verified CPA or execution authority.");
      } else {
        setNotice("API returned HTTP " + response.status + "; no success is attested.");
      }
    } catch (error) {
      const category = error instanceof NeonPreviewTokenUnavailable ? error.category : null;
      setNotice(demandMetaBrowserDiagnostic(phase, category));
    } finally { setBusy(false); }
  }

  async function saveHistoricalEvidence() {
    if (busy) return;
    setBusy(true);
    setEvidenceNotice(null);
    setNotice("Saving one historical Meta observation in Neon DEV and checking replay…");
    try {
      if (!(await verifiedSession())) throw new Error();
      const jwt = await requestNeonPreviewToken(auth());
      const response = await fetch("/api/internal/demand-meta-evidence", {
        method: "POST", headers: { Authorization: "Bearer " + jwt },
        cache: "no-store", redirect: "error",
      });
      if (response.status === 404) {
        setNotice("DEV evidence action is disabled or not configured. No success is claimed.");
        return;
      }
      if (response.status !== 200) {
        setNotice("DEV evidence action returned HTTP " + response.status +
          "; no completion is attested. A first append may have committed; database reconciliation is required before assuming nothing was saved.");
        return;
      }
      if (!probeHeaders(response)) throw new Error();
      const raw = await response.text();
      if (raw.length > 2048) throw new Error();
      const body: unknown = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 8 || !("status" in body) ||
          (body.status !== "inserted" && body.status !== "replayed") ||
          !("recordId" in body) || typeof body.recordId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.recordId) ||
          !("source" in body) || body.source !== "DIRECT_META_GRAPH_API" ||
          !("durableBciEvidenceRecorded" in body) || body.durableBciEvidenceRecorded !== true ||
          !("postCommitReplayVerified" in body) || body.postCommitReplayVerified !== true ||
          !("independentlyAttestedProvider" in body) || body.independentlyAttestedProvider !== false ||
          !("verifiedPaidOrders" in body) || body.verifiedPaidOrders !== null ||
          !("campaignExecutionAllowed" in body) || body.campaignExecutionAllowed !== false) throw new Error();
      setEvidenceNotice("DEV evidence " + body.status + ". Receipt: " + body.recordId +
        ". Post-commit readback and same-snapshot replay PASS. Independent provider readback remains required; no HitPay attribution, verified CPA or advertising authority.");
      setNotice("Historical Meta evidence action completed; see the separate receipt below.");
    } catch {
      setNotice("DEV evidence action could not complete. A first append may already have committed; reconcile the database before assuming nothing was saved. Replays use the same immutable key.");
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
      setEvidenceNotice(null);
      setNotice("Neon Auth session signed out.");
    } catch {
      setNotice("Sign-out not confirmed.");
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-shell neon-preview-shell">
      <section className="auth-card" aria-labelledby="demand-test-heading">
        <p className="eyebrow">BROS DEMAND · INTERNAL PREVIEW ONLY</p>
        <h1 id="demand-test-heading">Direct Meta verification</h1>
        <p className="sub">Read Meta reports and explicitly save one bounded observation in Neon DEV. Reporting and evidence actions have separate server controls. This page cannot create or change ads.</p>
        <p className="sub">Vercel Authentication protects the Preview URL. Sign in to Vercel first if prompted. This is separate from Neon Auth email OTP. You can run no-token HTTP rejection checks without a Neon Auth session.</p>
        <p role="status" aria-live="polite">{notice}</p>
        {stage === "ready" && evidenceNotice !== null ? <p role="status" aria-label="DEV evidence receipt">{evidenceNotice}</p> : null}
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
              <button type="button" disabled={busy} onClick={() => checkReadOnly("pinned")}>Check signed JWT + pinned ACQ-V2 read-only API</button>
              <button type="button" disabled={busy} onClick={() => checkReadOnly("historical")}>Check historical PAUSED BROS SELL (8–27 Oct) read-only</button>
              <button type="button" disabled={busy} onClick={saveHistoricalEvidence}>Save historical Meta evidence + verify replay (DEV)</button>
              <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
            </>
          ) : null}
        </div>
        <p className="sub">No JWT, code, access token, tenant ID or database password is shown or written to storage. All provider reads require a manual click and are confined to the pinned ACQ-V2 window or one server-locked historical PAUSED BROS SELL control window. No arbitrary campaign selection.</p>
      </section>
    </main>
  );
}

