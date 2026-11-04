import { inspectMetaConnection } from "../marketing-operator/meta-connection.ts";
import { pilotMetaConfiguration } from "./meta-pilot-environment.ts";
import { createPilotProvider } from "./meta-pilot-provider.ts";
import { PILOT, STAGE_STEPS, policyDigest, verifiedIdentities, launchAttestation, validateAsset,
  type Snapshot, type Step } from "./meta-pilot-policy.ts";
import { createPilotLedger, PilotReconciliationRequired, type PilotScope } from "./meta-pilot-ledger.ts";

export type PilotLedger = ReturnType<typeof createPilotLedger>;
export type PilotServiceDependencies = {
  environment: NodeJS.ProcessEnv;
  readToken: () => string | null;
  ledger: (scope: PilotScope) => PilotLedger;
  reauthorize: () => Promise<void>;
  now: () => number;
  transport?: typeof fetch;
};
export function createPilotService(deps: PilotServiceDependencies) {
  const { environment: env, managementCredentialConflict } = pilotMetaConfiguration(deps.environment);
  const configured = () => ({
    managementToken: Boolean(env.META_ADS_MANAGEMENT_TOKEN && env.META_ADS_MANAGEMENT_TOKEN.length >= 24),
    appSecret: Boolean(env.META_APP_SECRET && env.META_APP_SECRET.length >= 16),
    appId: env.META_APP_ID === "1315572270590189",
    ledger: env.BROS_DEMAND_META_PILOT_LEDGER === "reviewed-v1",
    stage: env.BROS_DEMAND_META_PILOT_STAGE === "approved-v5",
    launch: env.BROS_DEMAND_META_PILOT_LAUNCH === policyDigest,
  });
  const provider = (token: string) => createPilotProvider(token, deps.transport,
    token === env.META_ADS_MANAGEMENT_TOKEN ? env.META_APP_SECRET : undefined);
  async function writeCredential() {
    if (managementCredentialConflict) throw Error("META_MANAGEMENT_TOKEN_CONFIGURATION_CONFLICT");
    const connection = await inspectMetaConnection("write", env, deps.transport, deps.now());
    if (connection.status !== "READY") throw Error("META_MANAGEMENT_CONNECTION_NOT_VERIFIED");
    return env.META_ADS_MANAGEMENT_TOKEN!;
  }
  async function snapshotFor(scope: PilotScope) {
    if (!configured().ledger) throw Error("PILOT_LEDGER_PERMISSION_REVIEW_REQUIRED");
    return deps.ledger(scope).snapshot();
  }
  return {
    async readiness(scope: PilotScope) {
      const flags = configured(), blockers: string[] = [];
      if (managementCredentialConflict) blockers.push("META_MANAGEMENT_TOKEN_CONFIGURATION_CONFLICT");
      if (!flags.managementToken) blockers.push("META_MANAGEMENT_TOKEN_MISSING");
      if (!flags.appSecret || !flags.appId) blockers.push("META_APP_CONFIGURATION_MISSING");
      if (!flags.ledger) blockers.push("PILOT_LEDGER_PERMISSION_REVIEW_REQUIRED");
      if (!flags.stage) blockers.push("PAUSED_STAGING_GATE_LOCKED");
      let identities = false, qa = false;
      try { verifiedIdentities(env); identities = true; } catch { blockers.push("MALAYSIA_VERIFIED_IDENTITIES_REQUIRED"); }
      try { launchAttestation(env, deps.now()); qa = true; } catch { blockers.push("REAL_PURCHASE_QA_RECEIPT_REQUIRED"); }
      if (!flags.launch) blockers.push("LIVE_LAUNCH_GATE_LOCKED");
      let snapshot: Snapshot = {}, ledgerVerified = false;
      if (flags.ledger) {
        try { snapshot = await snapshotFor(scope); ledgerVerified = true; }
        catch (e) { blockers.push(e instanceof PilotReconciliationRequired ? "PROVIDER_RECONCILIATION_REQUIRED" : "PILOT_LEDGER_UNAVAILABLE"); }
      }
      let providerVerified = false, launchReadbackVerified = false, campaignStatus: string | null = null, adsets: number | null = null;
      const token = deps.readToken();
      if (token) {
        try {
          const state = await provider(token).read();
          campaignStatus = String(state.campaign.status); adsets = state.adsets.length; providerVerified = true;
          if (ledgerVerified) provider(token).assertObjects(state, snapshot, false, deps.now());
          if (identities) provider(token).assertIdentities(state, verifiedIdentities(env));
          if (STAGE_STEPS.every(s => snapshot[s])) {
            try { provider(token).assertObjects(state, snapshot, true, deps.now()); launchReadbackVerified = true; }
            catch { blockers.push("META_LAUNCH_READBACK_NOT_VERIFIED"); }
          }
        } catch { blockers.push("FRESH_CAMPAIGN_READBACK_NOT_VERIFIED"); providerVerified = false; }
      } else blockers.push("META_READ_TOKEN_MISSING");
      let managementVerified = false;
      if (flags.managementToken && flags.appSecret && flags.appId) {
        const check = await inspectMetaConnection("write", env, deps.transport, deps.now());
        managementVerified = check.status === "READY";
        if (!managementVerified) blockers.push("META_MANAGEMENT_CONNECTION_NOT_VERIFIED");
      }
      await deps.reauthorize();
      const staged = STAGE_STEPS.filter(s => snapshot[s]).length;
      return { source: "BROS_DEMAND_META_PILOT" as const, campaignId: PILOT.campaign,
        budgetMinor: PILOT.budgetMinor, currency: "MYR", durationDays: 7,
        providerVerified, campaignStatus, adsets, stagedSteps: staged, totalStageSteps: STAGE_STEPS.length,
        managementVerified, ledgerVerified, blockers,
        // These indicate admission to an action; they are not E2E completion claims.
        canStage: managementVerified && ledgerVerified && identities && qa && flags.stage && providerVerified &&
          campaignStatus === "PAUSED" && staged < STAGE_STEPS.length && !snapshot.refresh_flight,
        canActivate: managementVerified && ledgerVerified && identities && flags.launch && qa &&
          providerVerified && launchReadbackVerified && campaignStatus === "PAUSED" && staged === STAGE_STEPS.length,
        canPause: managementVerified,
        operatorLaunchAttestationConfigured: qa,
        independentPurchaseTrackingVerifiedByThisCheck: false,
      };
    },
    async stage(scope: PilotScope, assets: { a: Uint8Array; b: Uint8Array }) {
      if (!configured().stage) throw Error("PAUSED_STAGING_GATE_LOCKED");
      // Even PAUSED objects are provider writes. Require current real-purchase
      // tracking evidence before uploading assets or creating any Meta child.
      launchAttestation(env, deps.now());
      validateAsset("a", assets.a); validateAsset("b", assets.b);
      const identities = verifiedIdentities(env);
      const snapshot = await snapshotFor(scope), ledger = deps.ledger(scope);
      const api = provider(await writeCredential());
      const state = await api.read(); api.assertPaused(state); api.assertObjects(state, snapshot, false, deps.now());
      api.assertIdentities(state, identities);
      // Every remaining object must be disabled before another is staged.
      if (state.adsets.some(s => s.status !== "PAUSED")) throw Error("PAUSED_ADSET_REQUIRED");
      const step = STAGE_STEPS.find(s => !snapshot[s]);
      if (!step) return { status: "staged", campaignId: PILOT.campaign, stagedSteps: STAGE_STEPS.length };
      await deps.reauthorize();
      await ledger.perform(step, async () => {
        await deps.reauthorize();
        const performWrite = async () => {
        if (step === "image_a" || step === "image_b") return api.upload(assets[step === "image_a" ? "a" : "b"]);
        if (step === "adset") {
          const r = await api.createAdset(identities, deps.now());
          const after = await api.read(); api.assertPaused(after);
          api.assertObjects(after, { ...snapshot, adset: r }, false, deps.now());
          return r;
        }
        const key = step.endsWith("a") ? "a" : "b";
        if (step.startsWith("creative_")) return api.createCreative(key, snapshot[key === "a" ? "image_a" : "image_b"]!.hash!);
        const r = await api.createAd(key, snapshot.adset!.id!, snapshot[key === "a" ? "creative_a" : "creative_b"]!.id!);
        const after = await api.read(); api.assertPaused(after);
        api.assertObjects(after, { ...snapshot, [step]: r }, false, deps.now());
        return r;
        };
        const result = await performWrite();
        await deps.reauthorize();
        return result;
      });
      return { status: step === "ad_b" ? "staged" : "staging", campaignId: PILOT.campaign,
        stagedSteps: STAGE_STEPS.indexOf(step) + 1 };
    },
    async activate(scope: PilotScope) {
      if (!configured().launch) throw Error("LIVE_LAUNCH_GATE_LOCKED");
      launchAttestation(env, deps.now()); verifiedIdentities(env);
      const snapshot = await snapshotFor(scope), ledger = deps.ledger(scope);
      const api = provider(await writeCredential());
      if (snapshot.activate_campaign) {
        const state = await api.read();
        if (state.campaign.status !== "ACTIVE") throw Error("CAMPAIGN_STATE_REQUIRES_RECONCILIATION");
        return { status: "activation_accepted", campaignId: PILOT.campaign, deliveryVerified: false };
      }
      const state = await api.read(); api.assertPaused(state);
      api.assertIdentities(state, verifiedIdentities(env));
      api.assertObjects(state, snapshot, true, deps.now());
      await api.exclusive(); await deps.reauthorize();
      const steps: readonly Step[] = ["refresh_flight", "activate_ad_a", "activate_ad_b", "activate_adset", "activate_campaign"];
      const step = steps.find(s => !snapshot[s])!;
      const objectId = step === "activate_ad_a" ? snapshot.ad_a!.id! : step === "activate_ad_b" ? snapshot.ad_b!.id! :
        step === "activate_adset" ? snapshot.adset!.id! : PILOT.campaign;
      try {
        const result = await ledger.perform(step, async () => {
          await deps.reauthorize();
          const result = step === "refresh_flight" ? await api.refreshFlight(snapshot.adset!.id!, deps.now()) : await api.activate(objectId);
          await deps.reauthorize();
          return result;
        });
        const after = await api.read();
        api.assertObjects(after, { ...snapshot, [step]: result }, true, deps.now());
        if (step === "activate_campaign" && after.campaign.status !== "ACTIVE") throw Error();
        return { status: step === "activate_campaign" ? "activation_accepted" : "activating",
          campaignId: PILOT.campaign, deliveryVerified: false };
      } catch {
        // Parent is the last enable step. On any uncertainty, stop the fixed parent.
        try { await api.pause(); } catch { /* Response still demands provider reconciliation. */ }
        throw new PilotReconciliationRequired();
      }
    },
    async pause(scope: PilotScope) {
      // Emergency stop is independent of expired flight/QA/ledger/staging flags.
      const api = provider(await writeCredential()); await deps.reauthorize();
      let futureCommandsRevoked = false;
      if (configured().ledger) {
        try { await deps.ledger(scope).revoke(); futureCommandsRevoked = true; }
        catch { /* Still attempt a fixed-parent stop if the database is unavailable. */ }
      }
      await api.pause();
      return { status: "paused", campaignId: PILOT.campaign, providerReadbackVerified: true,
        futureCommandsRevoked, durablePauseReceiptRecorded: false };
    },
  };
}
