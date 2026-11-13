"use client";
import { useState } from "react";
import PausedCampaignCreator from "./paused-campaign-creator";

type Readiness = { source: "BROS_DEMAND_META_PILOT"; campaignId: string; providerVerified: boolean;
  campaignStatus: string | null; adsets: number | null; stagedSteps: number; totalStageSteps: number;
  blockers: string[]; canStage: boolean; canActivate: boolean; canPause: boolean;
  spend: { source: "META_GRAPH_INSIGHTS"; spendMinor: number | null; window: string; status: "REPORTED" | "NO_ROWS" } | null;
  externallyManaged: boolean; workV5Recognized: boolean; observedAdsets: { id: string; status: string; effectiveStatus: string; startTime: string | null; endTime: string | null }[]; observedAds: { id: string; adsetId: string; status: string; effectiveStatus: string }[] };
const endpoint = "/api/internal/demand-meta-pilot";
const blockerText: Record<string, string> = {
  META_MANAGEMENT_TOKEN_MISSING: "Add the business-owned Meta management credential in the protected server settings.",
  META_APP_CONFIGURATION_MISSING: "Complete the Meta app ID and app-secret configuration in the protected server settings.",
  PILOT_LEDGER_PERMISSION_REVIEW_REQUIRED: "The execution ledger needs its scoped database permission review.",
  PAUSED_STAGING_GATE_LOCKED: "Preparing paused ads is locked until the connection and ledger are verified.",
  MALAYSIA_VERIFIED_IDENTITIES_REQUIRED: "Confirm the verified Malaysia beneficiary and payer identities in Meta.",
  REAL_PURCHASE_QA_RECEIPT_REQUIRED: "Verify a real RM100 checkout, Purchase event, deduplication and campaign tracking; record the evidence.",
  LIVE_LAUNCH_GATE_LOCKED: "Live launch has a separate server approval control.",
  PROVIDER_RECONCILIATION_REQUIRED: "A previous action may have committed. Reconcile Meta and the ledger before retrying.",
  PILOT_LEDGER_UNAVAILABLE: "The execution ledger could not be independently read.",
  FRESH_CAMPAIGN_READBACK_NOT_VERIFIED: "The current Meta campaign settings could not be verified.",
  EXTERNAL_CAMPAIGN_OBJECTS_UNRECONCILED: "Meta contains externally created campaign objects that do not match the exact approved V5 IDs. No execution-ledger adoption or mutation is permitted.",
  META_SPEND_READBACK_UNVERIFIED: "Meta spending data could not be independently verified; no spend amount is asserted.",
  META_READ_TOKEN_MISSING: "The server Meta reporting credential is unavailable.",
  META_MANAGEMENT_CONNECTION_NOT_VERIFIED: "Meta has not verified the management credential, app and account access.",
  META_LAUNCH_READBACK_NOT_VERIFIED: "The staged ads, Meta review status or flight settings need verification before launch.",
};
export default function CampaignPilot({ getToken, signedIn, onSessionExpired }:
  { getToken: () => Promise<string>; signedIn: boolean; onSessionExpired: () => void }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [notice, setNotice] = useState("Check the existing campaign before preparing or launching ads.");
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<File | null>(null), [b, setB] = useState<File | null>(null);
  async function request(form?: FormData) {
    const token = await getToken();
    const response = await fetch(endpoint, { method: form ? "POST" : "GET", body: form,
      headers: { Authorization: "Bearer " + token }, credentials: "same-origin", cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(55000) });
    if ([401, 403].includes(response.status)) { onSessionExpired(); throw Error("Sign in again, then refresh readiness."); }
    if (response.status === 404) throw Error("Campaign controls are unavailable in this deployment.");
    if (!response.headers.get("cache-control")?.includes("no-store")) throw Error("Campaign response could not be verified.");
    const body = await response.json();
    if (!response.ok) throw Error(body?.reconcileRequired === true ?
      "An action may have committed. Stop and reconcile Meta and the ledger before retrying." :
      "Action blocked. Refresh readiness to see the outstanding requirements.");
    return body;
  }
  async function refresh() {
    if (busy) return; setBusy(true);
    setNotice("Reading current Meta settings and execution controls…");
    try {
      const r = await request();
      if (r?.source !== "BROS_DEMAND_META_PILOT" || r.campaignId !== "120251158023300697" ||
          !Array.isArray(r.blockers) || !r.blockers.every((x: unknown) => typeof x === "string")) throw Error("Readiness response could not be verified.");
      setReadiness(r);
      setNotice(r.providerVerified ? "Current campaign readback verified. Review the remaining requirements below." :
        "Current campaign readback is unverified. Execution remains blocked.");
    } catch (e) { setReadiness(null); setNotice(e instanceof Error ? e.message : "Readiness unavailable."); }
    finally { setBusy(false); }
  }
  async function act(action: "stage" | "activate" | "pause") {
    if (busy) return; setBusy(true);
    setNotice(action === "stage" ? "Preparing approved ads in PAUSED state…" : action === "pause" ?
      "Pausing the existing campaign and checking Meta…" : "Checking launch controls and enabling the approved campaign…");
    try {
      const limit = action === "stage" ? 7 : action === "activate" ? 5 : 1;
      for (let step = 0; step < limit; step++) {
        const form = new FormData(); form.set("action", action);
        if (action === "stage") {
          // The server journals each approved upload. Resuming later PAUSED steps
          // must not require reselecting files already recorded in the ledger.
          if (readiness?.stagedSteps === 0 && (!a || !b)) throw Error("Select both approved V5 image files.");
          if (readiness?.stagedSteps === 1 && !b) throw Error("Select approved V5 image B.");
          if (a) form.set("a", a);
          if (b) form.set("b", b);
        }
        const r = await request(form);
        if (r.campaignId !== "120251158023300697") throw Error("Campaign response could not be verified.");
        if (r.status === "staged") { setNotice("Approved ads staged in PAUSED state. Live launch remains a separate action."); break; }
        if (r.status === "activation_accepted") { setNotice("Meta accepted activation. Delivery and paid-order attribution still require independent verification."); break; }
        if (r.status === "paused" && r.providerReadbackVerified === true) { setNotice(r.futureCommandsRevoked ?
          "Meta confirms PAUSED. Further launch commands are revoked until review." :
          "Meta confirms PAUSED now. The database stop record is unverified; reconcile any in-flight command."); break; }
        if (!["staging", "activating"].includes(r.status)) throw Error("Action result unverified; reconcile before retrying.");
        if (step === limit - 1) throw Error("Action did not complete; reconcile before retrying.");
      }
      setReadiness(null);
    } catch (e) { setReadiness(null); setNotice(e instanceof Error ? e.message : "Action may have committed. Reconcile before retrying."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="campaign-pilot-heading" className="auth-form" style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
    <h2 id="campaign-pilot-heading">Meta campaigns</h2>
    <PausedCampaignCreator getToken={getToken} signedIn={signedIn} onSessionExpired={onSessionExpired}/>
    <p className="sub">Existing BROS SELL campaign · RM140 total · 7 days · Malaysia, ages 21–45 · two approved V5 ads.</p>
    <p role="status" aria-label="Campaign execution status">{notice}</p>
    <button type="button" disabled={busy || !signedIn} onClick={refresh}>Check campaign readiness</button>
    {!signedIn ? <p className="sub">Sign in above to check access. Unavailable controls will explain what is missing.</p> : null}
    {readiness ? <>
      <p>Meta readback: {readiness.providerVerified ? "VERIFIED" : "UNVERIFIED"}. Campaign: {readiness.campaignStatus ?? "unknown"}. Paused staging: {readiness.stagedSteps}/{readiness.totalStageSteps} steps.</p>
      <p>Meta spending (maximum available reporting window): {readiness.spend?.status === "REPORTED" && readiness.spend.spendMinor !== null ? `RM ${(readiness.spend.spendMinor / 100).toFixed(2)} — Meta Graph Insights` : "Unavailable / no delivery rows; not verified as RM0"}.</p>
      {readiness.externallyManaged ? <p role="status">{readiness.workV5Recognized ? "The exact two Work-created V5 ad IDs were recognized from Meta readback." : "External Meta objects detected; exact V5 IDs are not confirmed."} This pilot will not recreate or adopt them into its execution ledger. Read-only observation only; independent reconciliation is required before any write.</p> : null}
      {readiness.observedAdsets?.length ? <div><h3>Meta provider ad-set readback</h3><ul>{readiness.observedAdsets.map(set => <li key={set.id}>Ad set {set.id} · {set.status} / {set.effectiveStatus} · Flight: {set.startTime ?? "unavailable"} to {set.endTime ?? "unavailable"}</li>)}</ul></div> : null}
      {readiness.observedAds.length ? <div><h3>Meta provider ad readback</h3><ul>{readiness.observedAds.map(ad => <li key={ad.id}>Ad {ad.id} · Ad set {ad.adsetId} · {ad.status} / {ad.effectiveStatus}</li>)}</ul></div> : null}
      {readiness.externallyManaged ? <p role="note"><strong>External campaign — observation only.</strong> This application did not create these ads. The staging, activation and pause controls below are not authorized to change them. To manage a future campaign from BROS DEMAND, a separately reviewed execution workflow is required.</p> : null}
      {readiness.blockers.length ? <ul>{readiness.blockers.map(reason => <li key={reason}>{blockerText[reason] ?? "An execution requirement remains unverified."}</li>)}</ul> : null}
      {readiness.canStage && readiness.stagedSteps < 2 ? <>
        <label htmlFor="pilot-asset-a">Approved V5 image A</label><input id="pilot-asset-a" type="file" accept="image/jpeg" disabled={busy} onChange={e => setA(e.target.files?.[0] ?? null)} />
        <label htmlFor="pilot-asset-b">Approved V5 image B</label><input id="pilot-asset-b" type="file" accept="image/jpeg" disabled={busy} onChange={e => setB(e.target.files?.[0] ?? null)} />
      </> : null}
      <button type="button" disabled={busy || readiness.externallyManaged || !readiness.canStage || (readiness.stagedSteps === 0 && (!a || !b)) || (readiness.stagedSteps === 1 && !b)} onClick={() => act("stage")}>Prepare approved ads — PAUSED</button>
      <button type="button" disabled={busy || readiness.externallyManaged || !readiness.canActivate} onClick={() => act("activate")}>Launch approved RM140 campaign</button>
      <button type="button" disabled={busy || readiness.externallyManaged || !readiness.canPause} onClick={() => act("pause")}>Pause existing campaign</button>
    </> : null}
  </section>;
}
