"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient, type VanillaBetterAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter, type BetterAuthVanillaAdapterInstance } from "@neondatabase/auth/vanilla/adapters";
import { requestNeonPreviewToken, NeonPreviewTokenUnavailable, requestNeonPreviewSession } from "@/lib/bci/neon-preview-client-token";
import { runNeonPreviewNegativeChecks, runNeonPreviewEmptyTenantIsolationSmoke } from "@/lib/bci/neon-preview-negative-checks";
import { demandReviewProposal, parseDemandProposalResponse } from "@/lib/bci/neon-demand-proposal-client";

const operatorEmail = "rasymokh@gmail.com";
const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
let client: VanillaBetterAuthClient | undefined;
function auth(): VanillaBetterAuthClient {
  client ??= createAuthClient<BetterAuthVanillaAdapterInstance>(authBase, {
    adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: "include" } }),
  });
  return client;
}

async function hasVerifiedOperatorSession(): Promise<boolean> {
  return requestNeonPreviewSession(auth(), operatorEmail);
}

export default function NeonPreviewSignIn() {
  const [step, setStep] = useState<"start" | "verify-code" | "signin-code" | "ready">("start");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("Checking your development session…");
  // Keep independent, sanitized test summaries visible until sign-out or rerun.
  // Do not persist tokens, response bodies, identity claims, or check results.
  const [httpCheckResult, setHttpCheckResult] = useState<string | null>(null);
  const [tenantCheckResult, setTenantCheckResult] = useState<string | null>(null);
  const [writerCheckResult, setWriterCheckResult] = useState<string | null>(null);
  const [lineageCheckResult, setLineageCheckResult] = useState<string | null>(null);
  const [caseLinkResult, setCaseLinkResult] = useState<string | null>(null);
  const [lineageReceiptResult, setLineageReceiptResult] = useState<string | null>(null);
  const [proposalResult, setProposalResult] = useState<string | null>(null);
  const [signalResult, setSignalResult] = useState<string | null>(null);
  const [product, setProduct] = useState<"content" | "demand">("content");

  useEffect(() => {
    let cancelled = false;
    // Restoring an existing session never requests or sends an email.
    hasVerifiedOperatorSession().then(verified => {
      if (cancelled) return;
      setStep(verified ? "ready" : "start");
      setMessage(verified ? "Your email is verified and you are signed in." : "Neon Console Google login is separate from BROS app login. Verify your email here first, or sign in if already verified.");
    }).catch(() => {
      if (!cancelled) setMessage("Your session could not be checked. You can request a new sign-in code.");
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(kind: "verify" | "signin") {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setMessage("Requesting your sign-in code…");
    try {
      const { error } = await auth().emailOtp.sendVerificationOtp({ email: operatorEmail, type: kind === "verify" ? "email-verification" : "sign-in" });
      if (error) throw new Error();
      setCode("");
      setStep(kind === "verify" ? "verify-code" : "signin-code");
      setCooldown(60);
      setMessage(kind === "verify" ? "Enter the Neon Auth email-verification code to confirm mailbox ownership." : "Enter the Neon Auth sign-in code. Do not share the code.");
    } catch {
      setMessage("The code could not be requested. Check your connection and try again. No access has been granted.");
    } finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !/^[0-9]{6}$/.test(code)) return;
    setBusy(true);
    setMessage("Verifying your sign-in code…");
    try {
      if (step === "verify-code") {
        const { error } = await auth().emailOtp.verifyEmail({ email: operatorEmail, otp: code });
        if (error) throw new Error();
        setCode("");
        setCooldown(0);
        if (await hasVerifiedOperatorSession()) {
          setStep("ready");
          setMessage("Your email is verified and you are signed in. Check protected access below.");
        } else {
          setStep("start");
          setMessage("Email verification accepted. Request a separate sign-in code to open your BROS session.");
        }
      } else if (step === "signin-code") {
        const { error } = await auth().signIn.emailOtp({ email: operatorEmail, otp: code });
        setCode("");
        if (error || !await hasVerifiedOperatorSession()) throw new Error();
        setStep("ready");
        setMessage("Your email is verified and you are signed in. Check protected access below.");
      } else throw new Error();
    } catch {
      setCode("");
      setMessage("The code could not be verified or a verified session was not created. Request a new code if needed.");
    } finally { setBusy(false); }
  }

  async function checkAccess() {
    if (busy) return;
    setBusy(true);
    setMessage("Checking your protected development access…");
    let phase: "session" | "token" | "request" | "response" = "session";
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      phase = "token";
      // The short-lived token stays in this call and is never displayed, persisted or logged.
      const token = await requestNeonPreviewToken(auth());
      phase = "request";
      const response = await fetch(`/api/internal/neon-evidence?product=${product}&limit=1`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
      });
      if (!response.ok) {
        // Do not surface authentication, membership or database failure stages.
        // A generic status prevents client-side authorization-stage enumeration.
        setMessage(`Protected access denied (HTTP ${response.status}). No access has been granted.`);
        return;
      }
      phase = "response";
      const result: unknown = await response.json();
      if (result === null || typeof result !== "object" || !("evidence" in result) ||
          !Array.isArray(result.evidence)) throw new Error();
      setMessage(`Protected ${product.toUpperCase()} access verified. ${result.evidence.length === 0
        ? "No development evidence is available in this scope."
        : "One development evidence record was returned."}`);
    } catch (error) {
      const category = phase === "token" && error instanceof NeonPreviewTokenUnavailable ? `; category: ${error.category}` : "";
      setMessage(`Protected access check failed before completion (phase: ${phase}${category}). No access has been granted.`);
    } finally { setBusy(false); }
  }

  async function checkNegativeAccess() {
    if (busy) return;
    setBusy(true);
    setHttpCheckResult(null); // Never retain an earlier PASS when a rerun starts.
    setMessage("Running read-only HTTP rejection probes…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      const token = await requestNeonPreviewToken(auth());
      const report = await runNeonPreviewNegativeChecks(token);
      setHttpCheckResult(`Authenticated CONTENT/DEMAND controls: ${report.authenticatedControlsPassed}/${report.authenticatedControlsTotal} passed; Preview HTTP rejection probes: ${report.passed}/${report.total} passed. These checks do not prove cross-tenant database isolation, membership revocation, or independent hosted verification.`);
      setMessage("HTTP rejection checks completed; see the separate result below.");
    } catch {
      setHttpCheckResult("Preview HTTP rejection probes could not complete. No security gate has been certified.");
      setMessage("HTTP rejection checks failed; see the separate result below.");
    } finally { setBusy(false); }
  }

  async function checkEmptyTenantIsolation() {
    if (busy) return;
    setBusy(true);
    setTenantCheckResult(null); // Never retain an earlier PASS when a rerun starts.
    setMessage("Checking the empty internal tenant against populated synthetic tenant data…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      const token = await requestNeonPreviewToken(auth());
      const report = await runNeonPreviewEmptyTenantIsolationSmoke(token);
      setTenantCheckResult(`Empty-tenant isolation smoke: ${report.passed}/${report.total} passed. This check is valid only while the internal operator tenant has zero evidence; it does not certify revocation, admin impersonation, or full cross-tenant security.`);
      setMessage("Empty-tenant isolation check completed; see the separate result below.");
    } catch {
      setTenantCheckResult("Empty-tenant isolation smoke could not complete. No isolation gate has been certified.");
      setMessage("Empty-tenant isolation check failed; see the separate result below.");
    } finally { setBusy(false); }
  }

  async function checkRestrictedWriterLogin() {
    if (busy) return;
    setBusy(true);
    setWriterCheckResult(null);
    setMessage("Running restricted writer read-only login probe in Neon DEV…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      const token = await requestNeonPreviewToken(auth());
      const response = await fetch("/api/internal/neon-evidence?product=demand&probe=writer", {
        method: "GET", headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "error",
      });
      if (response.status !== 200 || !/no-store/i.test(response.headers.get("cache-control") || "")) throw new Error();
      const raw = await response.text();
      if (raw.length > 1024) throw new Error();
      const payload: unknown = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).length !== 4 || !("scope" in payload) ||
          payload.scope !== "internal-development" ||
          !("writerLoginProbe" in payload) || payload.writerLoginProbe !== "pass" ||
          !("evidenceAppended" in payload) || payload.evidenceAppended !== false ||
          !("providerReceiptRecorded" in payload) || payload.providerReceiptRecorded !== false) throw new Error();
      setWriterCheckResult("Restricted writer direct PostgreSQL LOGIN + role/RLS + current membership: read-only smoke PASS. No evidence was inserted, no provider receipt authenticated, and full cross-tenant security acceptance remains open.");
      setMessage("Restricted writer DEV probe completed; see the separate result below.");
    } catch {
      setWriterCheckResult("Restricted writer direct LOGIN probe could not be verified. No database acceptance gate has been certified.");
      setMessage("Restricted writer DEV probe failed; see the separate result below.");
    } finally { setBusy(false); }
  }

  async function checkLineageLogin() {
    if (busy) return;
    setBusy(true);
    setLineageCheckResult(null);
    setMessage("Checking restricted lineage writer physical LOGIN in Neon DEV (read-only)…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      const token = await requestNeonPreviewToken(auth());
      const response = await fetch("/api/internal/neon-evidence?product=demand&probe=lineage", {
        method: "GET", headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "error",
      });
      if (response.status !== 200 || !/no-store/i.test(response.headers.get("cache-control") || "") ||
          !/Authorization/i.test(response.headers.get("vary") || "")) throw new Error();
      const raw = await response.text();
      if (raw.length > 1024) throw new Error();
      const payload: unknown = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).length !== 4 || !("scope" in payload) ||
          payload.scope !== "internal-development" ||
          !("lineageLoginProbe" in payload) || payload.lineageLoginProbe !== "pass" ||
          !("lineageAppended" in payload) || payload.lineageAppended !== false ||
          !("providerReceiptRecorded" in payload) || payload.providerReceiptRecorded !== false) throw new Error();
      setLineageCheckResult("Lineage writer physical LOGIN, least privilege, active membership, foreign scope and revoked-fixture principal negatives: read-only smoke PASS. Actual live membership revocation and durable append/replay remain OPEN.");
      setMessage("Lineage direct LOGIN check completed.");
    } catch {
      setLineageCheckResult("Lineage writer authenticated direct LOGIN check failed. No acceptance gate certified.");
      setMessage("Lineage direct LOGIN check failed.");
    } finally { setBusy(false); }
  }

  async function createDemandReviewCase() {
    if (busy || product !== "demand") return;
    setBusy(true); setCaseLinkResult(null);
    setMessage("Requesting signed DEV-only case/link append for the existing Meta receipt…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      const token = await requestNeonPreviewToken(auth());
      const response = await fetch("/api/internal/neon-demand-case", {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "error",
      });
      if (!response.ok || !/no-store/i.test(response.headers.get("cache-control") || "")) throw new Error();
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).length !== 5 || !("status" in payload) ||
          (payload.status !== "inserted" && payload.status !== "replayed") ||
          !("receiptId" in payload) || payload.receiptId !== "4b1d0b40-371f-4c82-aaa9-d77580f88fac" ||
          !("caseId" in payload) || typeof payload.caseId !== "string" ||
          !("reviewOnly" in payload) || payload.reviewOnly !== true ||
          !("providerAttested" in payload) || payload.providerAttested !== false) throw new Error();
      setCaseLinkResult(`Restricted case/link ${payload.status}: REVIEW only. Independent Neon readback still required; no diagnosis, ads action, outcome or learning executed.`);
      setMessage("DEV case/link action completed; see the bounded result below.");
    } catch {
      setCaseLinkResult("DEV case/link action not accepted. No write success certified.");
      setMessage("DEV case/link action denied or unavailable.");
    } finally { setBusy(false); }
  }


  async function saveDemandEvidenceLineage() {
    if (busy || product !== "demand") return;
    setBusy(true);
    setLineageReceiptResult(null);
    setMessage("Checking the existing Meta receipt for an unverified DEV lineage root…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      const token = await requestNeonPreviewToken(auth());
      const response = await fetch("/api/internal/neon-lineage-receipt", {
        method: "POST", headers: { Authorization: "Bearer " + token },
        cache: "no-store", redirect: "error",
      });
      if (response.status !== 200 ||
          !/no-store/i.test(response.headers.get("cache-control") || "")) throw new Error();
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).length !== 5 ||
          !("receiptId" in payload) || payload.receiptId !== "4b1d0b40-371f-4c82-aaa9-d77580f88fac" ||
          !("status" in payload) || (payload.status !== "inserted" && payload.status !== "replayed") ||
          !("stage" in payload) || payload.stage !== "evidence" ||
          !("verification" in payload) || payload.verification !== "unverified" ||
          !("providerAttested" in payload) || payload.providerAttested !== false) throw new Error();
      setLineageReceiptResult("DEV evidence-stage lineage " + payload.status +
        " (UNVERIFIED). Independent Neon post-commit readback/replay still required. No diagnosis, action, outcome or learning executed.");
      setMessage("Bounded DEV lineage action completed; see the result below.");
    } catch {
      setLineageReceiptResult("DEV lineage action was not accepted; no durable append certified.");
      setMessage("DEV lineage action denied or unavailable.");
    } finally { setBusy(false); }
  }

  async function saveDemandMetaSignal() {
    if (busy || product !== "demand" || step !== "ready") return;
    setBusy(true); setSignalResult(null);
    setMessage("Saving the bounded historical Meta observation and checking its committed source and lineage…");
    let requested = false;
    try {
      if (!await hasVerifiedOperatorSession()) {
        setStep("start");
        setSignalResult("Not submitted: a fresh verified development sign-in is required.");
        setMessage("Your development session has expired. Sign in before saving the observation.");
        return;
      }
      const token = await requestNeonPreviewToken(auth());
      requested = true;
      const response = await fetch("/api/internal/neon-lineage-receipt?operation=demand-meta-observation-v1", {
        method: "POST", headers: { Authorization: "Bearer " + token },
        credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (response.status !== 200 ||
          !/no-store/i.test(response.headers.get("cache-control") || "")) throw new Error();
      const raw = await response.text();
      if (raw.length > 2048) throw new Error();
      const p: unknown = JSON.parse(raw);
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== 10 ||
          !("receiptId" in p) || p.receiptId !== "4b1d0b40-371f-4c82-aaa9-d77580f88fac" ||
          !("signalId" in p) || typeof p.signalId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.signalId) ||
          !("signalVersion" in p) || p.signalVersion !== "DEMAND_META_OBSERVATION_V1" ||
          !("status" in p) || (p.status !== "inserted" && p.status !== "replayed") ||
          !("stage" in p) || p.stage !== "signal" || !("verification" in p) || p.verification !== "unverified" ||
          !("sourceSha256" in p) || typeof p.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sourceSha256) ||
          !("postCommitReadback" in p) || p.postCommitReadback !== true ||
          !("providerAttested" in p) || p.providerAttested !== false ||
          !("actionAuthorized" in p) || p.actionAuthorized !== false) throw new Error();
      setSignalResult(`DEV historical observation ${p.status}: ${p.signalId}. Version V1, UNVERIFIED; separate server read-only post-COMMIT source, node and edge checks passed. No verified sale, ad authority, outcome or learning. Independent Neon audit readback remains required.`);
      setMessage("Historical observation request completed; see the bounded result below.");
    } catch {
      setSignalResult(requested ? "The observation result is unconfirmed. An append may already have committed. Reconcile Neon before retrying; this operation reuses the same immutable key." :
        "Observation not submitted: development sign-in or token could not be verified.");
      setMessage("The DEV observation could not be confirmed. No automatic retry will run.");
    } finally { setBusy(false); }
  }

  async function submitDemandProposal() {
    if (busy || product !== "demand" || step !== "ready") return;
    setBusy(true);
    setProposalResult(null);
    setMessage("Submitting the reviewed DEV-only PROPOSED record…");
    // Display only a bounded failure category, never a JWT, response body or identity.
    let failureCategory = "session-check";
    try {
      if (!await hasVerifiedOperatorSession()) {
        setStep("start");
        setProposalResult("Not submitted: a fresh verified sign-in is required.");
        setMessage("Your development session has expired or is no longer verified. Request a new sign-in code, then review the proposal again.");
        return;
      }
      failureCategory = "token";
      const token = await requestNeonPreviewToken(auth());
      // A rejected fetch can occur after the server received the write.
      failureCategory = "request-unconfirmed";
      const response = await fetch("/api/internal/neon-demand-proposal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(demandReviewProposal),
        credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      failureCategory = `HTTP ${response.status}`;
      if (response.status !== 200 ||
          !/no-store/i.test(response.headers.get("cache-control") || "") ||
          !/Authorization/i.test(response.headers.get("vary") || "")) throw new Error();
      failureCategory = "response-validation";
      const raw = await response.text();
      if (raw.length > 1024) throw new Error();
      const result = parseDemandProposalResponse(JSON.parse(raw));
      setProposalResult(`DEV proposal ${result.status}: ${result.proposalId}. PROPOSED for review only; NOT approved, executed, provider-attested or an outcome. Independent Neon post-COMMIT readback remains required.`);
      setMessage("DEV proposal request completed; see the bounded result below.");
    } catch (error) {
      if (failureCategory === "token" && error instanceof NeonPreviewTokenUnavailable)
        failureCategory = `token-${error.category}`;
      if (failureCategory === "request-unconfirmed" || failureCategory === "response-validation") {
        setProposalResult(`DEV proposal result is unconfirmed (${failureCategory}). The server may already have saved it. Reconcile the existing case before retrying; do not assume nothing was saved.`);
      } else {
        setProposalResult(`DEV proposal was not accepted or verified (${failureCategory}). No durable proposal is certified.`);
      }
      if (failureCategory === "HTTP 401") {
        setStep("start");
        setMessage("Your development sign-in has expired. Request a new sign-in code, then review the proposal again.");
      } else {
        setMessage("DEV proposal could not be verified. You can refresh sign-in below; no automatic submission will be retried.");
      }
    } finally { setBusy(false); }
  }

  function refreshSignIn() {
    if (busy) return;
    setCode("");
    setStep("start");
    setMessage("Request a fresh sign-in code. After signing in, review the proposal and submit it explicitly; no write will be retried automatically.");
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await auth().signOut();
      if (error) throw new Error();
      setStep("start");
      setCode("");
      setHttpCheckResult(null);
      setTenantCheckResult(null);
      setWriterCheckResult(null);
      setLineageCheckResult(null);
      setLineageReceiptResult(null);
      setCaseLinkResult(null);
      setProposalResult(null);
      setSignalResult(null);
      setMessage("You have signed out of this development session.");
    } catch { setMessage("Sign-out could not be confirmed. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-shell neon-preview-shell bros-luminous bci-studio">
      <section className="auth-card" aria-labelledby="neon-preview-title">
        <div className="bci-hero">
          <span className="luminous-product-pill">BROS COMMERCIAL INTELLIGENCE</span>
          <p className="luminous-eyebrow" style={{marginTop:24}}>EVIDENCE / DIAGNOSIS / LEARNING</p>
          <h1 id="neon-preview-title">Intelligence made<br/>actionable.</h1>
          <p className="sub">One connected intelligence core. Keep source evidence, decisions and outcomes traceable across separate BROS products.</p>
          <p className="luminous-note">Private development workspace. Sign in using the approved operator account to access scoped evidence and review controls.</p>
        </div>
        <label className="auth-form">
          Approved email
          <input type="email" value={operatorEmail} readOnly autoComplete="email" />
        </label>
        <p role="status" aria-live="polite">{message}</p>
        {step === "ready" && httpCheckResult !== null ? <p role="status" aria-label="HTTP rejection check result">{httpCheckResult}</p> : null}
        {step === "ready" && tenantCheckResult !== null ? <p role="status" aria-label="Empty-tenant isolation result">{tenantCheckResult}</p> : null}
        {step === "ready" && writerCheckResult !== null ? <p role="status" aria-label="Restricted writer login result">{writerCheckResult}</p> : null}
        {step === "ready" && lineageCheckResult !== null ? <p role="status" aria-label="Lineage writer login result">{lineageCheckResult}</p> : null}
        {step === "ready" && caseLinkResult !== null ? <p role="status" aria-label="Restricted case/link result">{caseLinkResult}</p> : null}
        {step === "ready" && lineageReceiptResult !== null ? <p role="status" aria-label="Restricted lineage receipt result">{lineageReceiptResult}</p> : null}
        {proposalResult !== null ? <p role="status" aria-label="Restricted DEMAND proposal result">{proposalResult}</p> : null}
        {signalResult !== null ? <p role="status" aria-label="Restricted DEMAND observation result">{signalResult}</p> : null}
        {step === "start" ? <div className="auth-form">
          <button type="button" disabled={busy || cooldown > 0} onClick={() => sendCode("signin")}>
            {cooldown > 0 ? `Wait ${cooldown}s` : "Send sign-in code (verified email)"}
          </button>
          <button type="button" disabled={busy || cooldown > 0} onClick={() => sendCode("verify")}>
            Verify email (only if not verified)
          </button>
        </div> : null}
        {(step === "verify-code" || step === "signin-code") ? (
          <form className="auth-form" onSubmit={verifyCode}>
            <label>
              Sign-in code
              <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                minLength={6} maxLength={6} required value={code} disabled={busy}
                onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ""))} />
            </label>
            <button type="submit" disabled={busy || code.length !== 6}>{step === "verify-code" ? "Verify email" : "Sign in"}</button>
            <button type="button" disabled={busy || cooldown > 0} onClick={() => sendCode(step === "verify-code" ? "verify" : "signin")}>
              {cooldown > 0 ? `Resend available in ${cooldown}s` : "Send a new code"}
            </button>
          </form>
        ) : null}
        {step === "ready" ? (
          <div className="auth-form">
            <div className="bci-workspace-links" aria-label="BROS product workspaces">
              <a href="/internal/neon-preview/content-review">CONTENT / Creative review <span aria-hidden="true">↗</span></a>
              <a href="https://brosdemand.bolehejas.com/" target="_blank" rel="noopener noreferrer">DEMAND / Campaign workspace <span aria-hidden="true">↗</span></a>
            </div>
            <p className="luminous-eyebrow">RESTRICTED OPERATOR OPERATIONS</p>
            <label>
              Product
              <select value={product} disabled={busy} onChange={event => setProduct(event.target.value === "demand" ? "demand" : "content")}>
                <option value="content">BROS CONTENT</option>
                <option value="demand">BROS DEMAND</option>
              </select>
            </label>
            <button type="button" disabled={busy} onClick={checkAccess}>Check protected access</button>
            <button type="button" disabled={busy} onClick={checkNegativeAccess}>Run HTTP rejection checks</button>
            <button type="button" disabled={busy} onClick={checkEmptyTenantIsolation}>Check empty-tenant isolation (DEV)</button>
            <button type="button" disabled={busy} onClick={checkRestrictedWriterLogin}>Check restricted evidence writer LOGIN (DEV read-only)</button>
            <button type="button" disabled={busy} onClick={checkLineageLogin}>Check lineage writer LOGIN + tenant/product negatives (DEV read-only)</button>
            <button type="button" disabled={busy || product !== "demand"} onClick={createDemandReviewCase}>Save existing Meta receipt as REVIEW case (DEV only)</button>
            <button type="button" disabled={busy || product !== "demand"} onClick={saveDemandEvidenceLineage}>Append existing Meta receipt to unverified lineage (DEV only)</button>
            <button type="button" disabled={busy || product !== "demand"} onClick={saveDemandMetaSignal}>Save historical Meta observation + verify readback (DEV)</button>
            {product === "demand" ? <section className="auth-form" aria-label="Review BROS DEMAND DEV proposal">
              <h2>Review proposed diagnosis (DEV only)</h2>
              <p><strong>Hypothesis:</strong> {demandReviewProposal.hypothesis}</p>
              <p><strong>Proposed action:</strong> {demandReviewProposal.proposedAction}</p>
              <p><strong>Success metric:</strong> {demandReviewProposal.proposedSuccessMetric}</p>
              <p><strong>Confidence:</strong> {demandReviewProposal.confidence}. First-party joins remain unknown.</p>
              <p><strong>PROPOSED ≠ approved or executed.</strong> No live Meta changes, order attribution or outcome is claimed.</p>
              <button type="button" disabled={busy} onClick={submitDemandProposal}>Submit reviewed PROPOSED record (DEV only)</button>
            </section> : null}
            <button type="button" disabled={busy} onClick={refreshSignIn}>Refresh sign-in</button>
            <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

