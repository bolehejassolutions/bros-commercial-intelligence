"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient, type VanillaBetterAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter, type BetterAuthVanillaAdapterInstance } from "@neondatabase/auth/vanilla/adapters";
import { requestNeonPreviewToken, NeonPreviewTokenUnavailable } from "@/lib/bci/neon-preview-client-token";
import { runNeonPreviewNegativeChecks, runNeonPreviewEmptyTenantIsolationSmoke } from "@/lib/bci/neon-preview-negative-checks";

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
  const { data, error } = await auth().getSession();
  return !error && Boolean(data?.session && data.user?.email === operatorEmail && data.user.emailVerified === true);
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
      setMessage("You have signed out of this development session.");
    } catch { setMessage("Sign-out could not be confirmed. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-shell neon-preview-shell">
      <section className="auth-card" aria-labelledby="neon-preview-title">
        <p className="eyebrow">BROS INTERNAL PREVIEW</p>
        <h1 id="neon-preview-title">Secure development access</h1>
        <p className="sub">Sign in with the approved operator email to check the private development connection.</p>
        <label className="auth-form">
          Approved email
          <input type="email" value={operatorEmail} readOnly autoComplete="email" />
        </label>
        <p role="status" aria-live="polite">{message}</p>
        {step === "ready" && httpCheckResult !== null ? <p role="status" aria-label="HTTP rejection check result">{httpCheckResult}</p> : null}
        {step === "ready" && tenantCheckResult !== null ? <p role="status" aria-label="Empty-tenant isolation result">{tenantCheckResult}</p> : null}
        {step === "ready" && writerCheckResult !== null ? <p role="status" aria-label="Restricted writer login result">{writerCheckResult}</p> : null}
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
            <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
