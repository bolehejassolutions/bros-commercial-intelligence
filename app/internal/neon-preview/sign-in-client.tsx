"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient, type VanillaBetterAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter, type BetterAuthVanillaAdapterInstance } from "@neondatabase/auth/vanilla/adapters";

const operatorEmail = "rasymokh@gmail.com";
const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
let client: VanillaBetterAuthClient | undefined;
function auth(): VanillaBetterAuthClient {
  client ??= createAuthClient<BetterAuthVanillaAdapterInstance>(authBase, { adapter: BetterAuthVanillaAdapter() });
  return client;
}

async function hasVerifiedOperatorSession(): Promise<boolean> {
  const { data, error } = await auth().getSession();
  return !error && Boolean(data?.session && data.user?.email === operatorEmail && data.user.emailVerified === true);
}

export default function NeonPreviewSignIn() {
  const [step, setStep] = useState<"start" | "code" | "ready">("start");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("Checking your development session…");
  const [product, setProduct] = useState<"content" | "demand">("content");

  useEffect(() => {
    let cancelled = false;
    // Restoring an existing session never requests or sends an email.
    hasVerifiedOperatorSession().then(verified => {
      if (cancelled) return;
      setStep(verified ? "ready" : "start");
      setMessage(verified ? "Your email is verified and you are signed in." : "Request a code to sign in with your approved email.");
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

  async function sendCode() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setMessage("Requesting your sign-in code…");
    try {
      const { error } = await auth().emailOtp.sendVerificationOtp({ email: operatorEmail, type: "sign-in" });
      if (error) throw new Error();
      setCode("");
      setStep("code");
      setCooldown(60);
      setMessage("Enter the code sent to your approved email. Keep the code in this page.");
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
      const { error } = await auth().signIn.emailOtp({ email: operatorEmail, otp: code });
      setCode("");
      if (error || !await hasVerifiedOperatorSession()) throw new Error();
      setStep("ready");
      setMessage("Your email is verified and you are signed in. Check protected access below.");
    } catch {
      setCode("");
      setMessage("Sign-in could not be verified. Enter a valid code, or request a new one when available.");
    } finally { setBusy(false); }
  }

  async function checkAccess() {
    if (busy) return;
    setBusy(true);
    setMessage("Checking your protected development access…");
    try {
      if (!await hasVerifiedOperatorSession()) throw new Error();
      // The short-lived token stays in this call and is never displayed, persisted or logged.
      const { data, error } = await auth().token();
      if (error || typeof data?.token !== "string") throw new Error();
      const response = await fetch(`/api/internal/neon-evidence?product=${product}&limit=1`, {
        headers: { Authorization: `Bearer ${data.token}` }, cache: "no-store", redirect: "error",
      });
      if (!response.ok) {
        setMessage("You are signed in, but protected access was denied. The development access gate remains closed.");
        return;
      }
      const result: unknown = await response.json();
      if (result === null || typeof result !== "object" || !("evidence" in result) ||
          !Array.isArray(result.evidence)) throw new Error();
      setMessage(`Protected ${product.toUpperCase()} access verified. ${result.evidence.length === 0
        ? "No development evidence is available in this scope."
        : "One development evidence record was returned."}`);
    } catch {
      setMessage("Protected access could not be verified. Your session or the development service may need attention.");
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
        {step === "start" ? <button type="button" disabled={busy || cooldown > 0} onClick={sendCode}>
          {cooldown > 0 ? `Request another code in ${cooldown}s` : "Send sign-in code"}
        </button> : null}
        {step === "code" ? (
          <form className="auth-form" onSubmit={verifyCode}>
            <label>
              Sign-in code
              <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                minLength={6} maxLength={6} required value={code} disabled={busy}
                onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ""))} />
            </label>
            <button type="submit" disabled={busy || code.length !== 6}>Verify and sign in</button>
            <button type="button" disabled={busy || cooldown > 0} onClick={sendCode}>
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
            <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
