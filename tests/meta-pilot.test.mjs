import test from "node:test";
import assert from "node:assert/strict";
import { PILOT, ASSETS, STAGE_STEPS, policyDigest, adsetBody, creativeBody, validateAsset,
  verifiedIdentities, launchAttestation } from "../lib/demand/meta-pilot-policy.ts";
import { createPilotProvider } from "../lib/demand/meta-pilot-provider.ts";
import { createPilotService } from "../lib/demand/meta-pilot-service.ts";
import { createPilotHttpHandler } from "../lib/demand/meta-pilot-http.ts";
import { createPilotLedger, PilotReconciliationRequired } from "../lib/demand/meta-pilot-ledger.ts";

const now = Date.parse("2026-11-02T08:00:00Z");
const scope = { tenantId: "11111111-1111-4111-8111-111111111111", principalId: "22222222-2222-4222-8222-222222222222" };
const env = () => ({ META_APP_ID: "1315572270590189", META_APP_SECRET: "synthetic-app-secret-value",
  META_ADS_MANAGEMENT_TOKEN: "synthetic-management-credential-value", BROS_DEMAND_META_PILOT_LEDGER: "reviewed-v1",
  BROS_DEMAND_META_PILOT_STAGE: "approved-v5", BROS_DEMAND_META_PILOT_LAUNCH: policyDigest,
  BROS_DEMAND_META_BENEFICIARY_ID: "99999999000001", BROS_DEMAND_META_PAYER_ID: "99999999000002",
  BROS_DEMAND_META_LAUNCH_QA_RECEIPT: JSON.stringify({ policyDigest, campaign: PILOT.campaign,
    amountMinor: 10000, currency: "MYR", pixel: PILOT.pixel, checkoutVerified: true,
    purchaseDedupVerified: true, utmVerified: true, paidOrderReference: "SYNTHETIC-ORDER",
    purchaseEventId: "SYNTHETIC-EVENT", evidenceUrl: "https://docs.google.com/document/d/SYNTHETIC_PROOF/edit",
    verifiedAt: new Date(now - 60000).toISOString() }) });

/** Synthetic provider fixture. These tests never claim live Meta acceptance. */
function fixture() {
  const config = env(), calls = [], identities = verifiedIdentities(config);
  const body = adsetBody(identities, now - 3600000);
  const snapshot = {
    image_a: { hash: "a".repeat(32) }, image_b: { hash: "b".repeat(32) },
    adset: { id: "33333333000001", start: body.start_time, end: body.end_time },
    creative_a: { id: "44444444000001" }, ad_a: { id: "55555555000001" },
    creative_b: { id: "44444444000002" }, ad_b: { id: "55555555000002" },
  };
  const account = { id: PILOT.account, account_id: PILOT.account.slice(4), currency: "MYR",
    timezone_name: "Asia/Kuala_Lumpur", account_status: 1, business: { id: "2091328444802994" }, user_tasks: ["ADVERTISE"] };
  const campaign = { id: PILOT.campaign, account_id: PILOT.account.slice(4), name: "BROS SELL",
    status: "PAUSED", effective_status: "PAUSED", objective: "OUTCOME_SALES", lifetime_budget: "14000",
    daily_budget: "0", budget_remaining: "14000", spend_cap: "0" };
  const set = { ...body, id: snapshot.adset.id, account_id: PILOT.account.slice(4), ads: { data: ["a", "b"].map(key => ({
    id: snapshot["ad_" + key].id, adset_id: snapshot.adset.id, status: "PAUSED", effective_status: "PAUSED",
    creative: { id: snapshot["creative_" + key].id, object_story_spec: creativeBody(key, snapshot["image_" + key].hash).object_story_spec },
  })) } };
  let otherActive = false, children = [set];
  const transport = async (input, init = {}) => {
    const u = new URL(String(input)); calls.push({ url: u, init });
    assert.equal(u.origin, "https://graph.facebook.com"); assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store"); assert.ok(init.signal);
    let data;
    if (init.method === "POST") {
      const form = new URLSearchParams(init.body);
      if (u.pathname.endsWith("/" + PILOT.campaign)) campaign.status = form.get("status");
      else if (u.pathname.endsWith("/" + set.id)) {
        if (form.has("status")) set.status = form.get("status");
        if (form.has("start_time")) { set.start_time = form.get("start_time"); set.end_time = form.get("end_time"); }
      } else {
        const ad = set.ads.data.find(a => u.pathname.endsWith("/" + a.id));
        if (ad) ad.status = form.get("status"); else throw Error("Unexpected synthetic write");
      }
      data = { success: true };
    } else if (u.pathname.endsWith("/debug_token")) data = { data: { app_id: config.META_APP_ID, is_valid: true,
      expires_at: Math.floor(now / 1000) + 86400, data_access_expires_at: 0, scopes: ["ads_management"] } };
    else if (u.pathname.endsWith("/" + config.META_APP_ID)) data = { id: config.META_APP_ID,
      name: "BROS Commercial Intelligence", business: { id: "2091328444802994" } };
    else if (u.pathname.endsWith("/2091328444802994/owned_apps")) data = { data: [{ id: config.META_APP_ID }] };
    else if (u.pathname.endsWith("/" + PILOT.account)) data = account;
    else if (u.pathname.endsWith("/" + PILOT.campaign)) data = campaign;
    else if (u.pathname.endsWith("/" + PILOT.campaign + "/adsets")) data = { data: children };
    else if (u.pathname.endsWith("/" + PILOT.account + "/campaigns")) data = { data: [campaign,
      ...(otherActive ? [{ id: "999999999999999", status: "ACTIVE", effective_status: "ACTIVE" }] : [])] };
    else throw Error("Unexpected synthetic read");
    return Response.json(data);
  };
  const ledger = { snapshot: async () => structuredClone(snapshot),
    perform: async (step, fn) => { if (snapshot[step]) return snapshot[step];
      const r = await fn(); snapshot[step] = r; return r; }, revoke: async () => { ledger.revoked = true; } };
  return { config, calls, snapshot, account, campaign, set, ledger, transport,
    emptyChildren: () => { children = []; }, other: () => { otherActive = true; } };
}
function service(f, overrides = {}) { return createPilotService({ environment: f.config, readToken: () => "synthetic-read-token",
  ledger: () => f.ledger, now: () => now, reauthorize: async () => {}, transport: f.transport, ...overrides }); }

test("approved existing campaign, CBO cap, age, placements, UTM and V5 copy are fixed", () => {
  const b = adsetBody(verifiedIdentities(env()), now);
  assert.equal(b.campaign_id, PILOT.campaign); assert.equal(b.status, "PAUSED");
  assert.equal(b.lifetime_budget, undefined); assert.equal(b.daily_budget, undefined);
  assert.deepEqual(b.targeting.geo_locations.countries, ["MY"]); assert.equal(b.targeting.age_min, 21); assert.equal(b.targeting.age_max, 45);
  assert.deepEqual(b.targeting.publisher_platforms, ["facebook", "instagram"]);
  assert.equal(Date.parse(b.end_time) - Date.parse(b.start_time), 7 * 86400000);
  assert.equal(creativeBody("a", "a".repeat(32)).object_story_spec.link_data.name, ASSETS.a.headline);
  assert.equal(new URL(ASSETS.b.url).searchParams.get("utm_content"), "creative_b_saya_fikir_dulu");
  assert.throws(() => validateAsset("a", new Uint8Array(ASSETS.a.size)), /APPROVED_V5/);
  assert.throws(() => verifiedIdentities({ ...env(), BROS_DEMAND_META_PAYER_ID: PILOT.page }), /VERIFIED_MALAYSIA/);
});
test("launch receipt rejects expired, wrong campaign, unpaid amount and synthetic flags alone", () => {
  for (const change of [{ amountMinor: 5000 }, { campaign: "999999999999" }, { checkoutVerified: false },
    { verifiedAt: new Date(now - 2 * 86400000).toISOString() }, { purchaseEventId: "" }, { policyDigest: "old" }]) {
    const e = env(); e.BROS_DEMAND_META_LAUNCH_QA_RECEIPT = JSON.stringify({ ...JSON.parse(e.BROS_DEMAND_META_LAUNCH_QA_RECEIPT), ...change });
    assert.throws(() => launchAttestation(e, now), /REAL_PURCHASE/);
  }
  assert.throws(() => launchAttestation({}, now), /REAL_PURCHASE/);
});
test("readiness with read-only credentials performs no writes and explains missing authority", async () => {
  const f = fixture(); f.config = {}; f.set = null;
  const r = await service(f).readiness(scope);
  assert.equal(r.canStage, false); assert.equal(r.canActivate, false); assert.equal(r.canPause, false);
  assert.equal(r.providerVerified, true); assert.ok(r.blockers.includes("META_MANAGEMENT_TOKEN_MISSING"));
  assert.equal(r.independentPurchaseTrackingVerifiedByThisCheck, false);
  assert.ok(f.calls.every(c => c.init.method === "GET"));
});
test("readiness never offers PAUSED staging for partially spent or active child state", async () => {
  for (const mutate of [
    f => { f.campaign.budget_remaining = "13999"; },
    f => { f.set.status = "ACTIVE"; },
  ]) {
    const f = fixture(); mutate(f);
    const r = await service(f).readiness(scope);
    assert.equal(r.providerVerified, true);
    assert.equal(r.managementVerified, true);
    assert.equal(r.canStage, false);
    assert.equal(r.canActivate, false);
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
  }
});

test("fully staged launch admission requires fresh unspent PAUSED provider state", async () => {
  const f = fixture();
  const start = new Date(now + 5 * 60000).toISOString();
  const end = new Date(Date.parse(start) + 7 * 86400000).toISOString();
  f.set.start_time = start; f.set.end_time = end;
  f.snapshot.refresh_flight = { id: f.set.id, start, end };
  const eligible = await service(f).readiness(scope);
  assert.equal(eligible.canActivate, true);
  f.campaign.budget_remaining = "13999";
  const spent = await service(f).readiness(scope);
  assert.equal(spent.providerVerified, true);
  assert.equal(spent.canActivate, false);
  assert.ok(spent.blockers.includes("PAUSED_UNSPENT_CAMPAIGN_REQUIRED"));
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});

test("owner-saved management name works through pilot readiness with authenticated GET proof", async () => {
  const f = fixture();
  f.config.BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN = f.config.META_ADS_MANAGEMENT_TOKEN;
  delete f.config.META_ADS_MANAGEMENT_TOKEN;
  const r = await service(f).readiness(scope);
  assert.equal(r.managementVerified, true); assert.equal(r.canPause, true);
  assert.ok(!r.blockers.includes("META_MANAGEMENT_TOKEN_MISSING"));
  assert.ok(f.calls.every(c => c.init.method === "GET"));
  const account = f.calls.find(c => c.init.headers.Authorization === "Bearer " + f.config.BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN);
  assert.ok(account); assert.ok(account.url.searchParams.get("appsecret_proof"));
});
test("conflicting management names block pilot writes before any provider request", async () => {
  const f = fixture();
  f.config.BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN = "synthetic-conflicting-owner-token-123456";
  await assert.rejects(service(f).pause(scope), /META_MANAGEMENT_TOKEN_CONFIGURATION_CONFLICT/);
  assert.equal(f.calls.length, 0);
});
test("provider read rejects campaign budget drift, account drift and incomplete pagination", async () => {
  for (const change of [f => { f.campaign.lifetime_budget = "14001"; }, f => { f.account.currency = "USD"; },
    f => { f.campaign.daily_budget = "100"; }]) {
    const f = fixture(); change(f); await assert.rejects(createPilotProvider("synthetic", f.transport).read());
    assert.ok(f.calls.every(c => c.init.method === "GET"));
  }
  const f = fixture(); const original = f.transport;
  await assert.rejects(createPilotProvider("synthetic", async (u, i) => String(u).includes("/adsets?") ?
    Response.json({ data: [], paging: { next: "https://evil.invalid/" } }) : original(u, i)).read(), /COMPLETE/);
});
test("PAUSED staging refuses absent, stale or mismatched paid-order QA before any Meta request", async () => {
  for (const change of [
    f => { delete f.config.BROS_DEMAND_META_LAUNCH_QA_RECEIPT; },
    f => { const q = JSON.parse(f.config.BROS_DEMAND_META_LAUNCH_QA_RECEIPT);
      q.verifiedAt = new Date(now - 2 * 86400000).toISOString();
      f.config.BROS_DEMAND_META_LAUNCH_QA_RECEIPT = JSON.stringify(q); },
    f => { const q = JSON.parse(f.config.BROS_DEMAND_META_LAUNCH_QA_RECEIPT);
      q.amountMinor = 5000; f.config.BROS_DEMAND_META_LAUNCH_QA_RECEIPT = JSON.stringify(q); },
  ]) {
    const f = fixture(); change(f);
    const readiness = await service(f).readiness(scope);
    assert.equal(readiness.canStage, false);
    const before = f.calls.length;
    await assert.rejects(service(f).stage(scope, {
      a: new Uint8Array(ASSETS.a.size), b: new Uint8Array(ASSETS.b.size),
    }), /CURRENT_REAL_PURCHASE_QA_RECEIPT_REQUIRED/);
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
    assert.ok(f.calls.length >= before);
  }
});

test("activation is blocked before any provider call when launch is locked", async () => {
  const f = fixture(); delete f.config.BROS_DEMAND_META_PILOT_LAUNCH;
  await assert.rejects(service(f).activate(scope), /LIVE_LAUNCH_GATE_LOCKED/); assert.equal(f.calls.length, 0);
});
test("synthetic activation refreshes 7-day flight, enables children before parent and never creates a campaign", async () => {
  const f = fixture(); let result;
  for (let i = 0; i < 5; i++) result = await service(f).activate(scope);
  assert.equal(result.status, "activation_accepted"); assert.equal(result.deliveryVerified, false);
  const writes = f.calls.filter(c => c.init.method === "POST");
  assert.deepEqual(writes.map(c => c.url.pathname.split("/").at(-1)), [f.set.id, f.snapshot.ad_a.id, f.snapshot.ad_b.id, f.set.id, PILOT.campaign]);
  assert.equal(new URLSearchParams(writes[0].init.body).get("lifetime_budget"), null);
  assert.equal(Date.parse(f.set.end_time) - Date.parse(f.set.start_time), 7 * 86400000);
  assert.equal(f.campaign.status, "ACTIVE");
  assert.ok(writes.every(c => !c.url.pathname.endsWith("/campaigns")));
});
test("target drift or another active campaign blocks activation without writes", async () => {
  for (const mutate of [f => { f.set.targeting.age_max = 65; }, f => { f.other(); },
    f => { f.set.ads.data[0].creative.object_story_spec.link_data.link = "https://evil.invalid/"; },
    f => { f.set.ads.data[0].effective_status = "PENDING_REVIEW"; }]) {
    const f = fixture(); mutate(f); await assert.rejects(service(f).activate(scope));
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
  }
});
test("failure after parent activation triggers parent pause and reports uncertain persistence", async () => {
  const f = fixture(), perform = f.ledger.perform;
  f.ledger.perform = async (step, fn) => { const r = await perform(step, fn);
    if (step === "activate_campaign") throw Error("synthetic commit uncertainty"); return r; };
  for (let i = 0; i < 4; i++) await service(f).activate(scope);
  await assert.rejects(service(f).activate(scope), PilotReconciliationRequired);
  assert.equal(f.campaign.status, "PAUSED");
  assert.equal(new URLSearchParams(f.calls.filter(c => c.init.method === "POST").at(-1).init.body).get("status"), "PAUSED");
});
test("pause does not depend on QA, flight, launch or staging gates", async () => {
  const f = fixture(); f.campaign.status = "ACTIVE";
  delete f.config.BROS_DEMAND_META_LAUNCH_QA_RECEIPT; delete f.config.BROS_DEMAND_META_PILOT_LAUNCH;
  delete f.config.BROS_DEMAND_META_PILOT_STAGE;
  const r = await service(f).pause(scope);
  assert.equal(r.providerReadbackVerified, true); assert.equal(r.futureCommandsRevoked, true);
  assert.equal(f.ledger.revoked, true); assert.equal(f.campaign.status, "PAUSED");
});

function fakeDatabase() {
  let events = [], tail = Promise.resolve(), failCommit = false;
  const query = async (sql, args = []) => {
    if (sql.includes("current_user AS role_name")) return { rows: [{ role_name: "bci_dev_evidence_writer_restricted",
      session_role: "bci_dev_evidence_writer_restricted", database_name: "bros_intelligence_dev", rolsuper: false,
      rolbypassrls: false, rolcanlogin: true, rolcreaterole: false, rolcreatedb: false, parents: 0 }] };
    if (sql.includes("AS forced_rls")) return { rows: [{ forced_rls: true, can_read: true, can_append: true, can_mutate: false, owns_table: false }] };
    if (sql.includes("FROM bci_dev.tenant_memberships")) return { rows: [{ principal_id: scope.principalId }] };
    if (sql.startsWith("SELECT set_config") || sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
    if (sql.includes("INSERT INTO bci_dev.demand_meta_pilot_events")) {
      const kind = sql.includes("'revoked'") ? "revoked" : sql.includes("'intent'") ? "intent" : "confirmed";
      const step = kind === "revoked" ? "stop" : args[3];
      if (events.some(e => e.step === step && e.kind === kind)) return { rows: [] };
      events.push({ step, kind, result: kind === "confirmed" ? JSON.parse(args[4]) : {} });
      return { rows: [{ id: "synthetic-event" }] };
    }
    if (sql.includes("FROM bci_dev.demand_meta_pilot_events")) return { rows: structuredClone(events.filter(e =>
      sql.includes("kind='revoked'") ? e.kind === "revoked" : args.length === 3 ? e.step === args[2] : true)) };
    throw Error("Unexpected query in transaction fixture");
  };
  const transaction = fn => {
    const run = tail.then(async () => {
      const before = structuredClone(events);
      try { const r = await fn(query);
        if (failCommit && events.some(e => e.kind === "confirmed") && !before.some(e => e.kind === "confirmed")) throw Error("synthetic COMMIT failed");
        return r;
      } catch (e) { events = before; throw e; }
    }); tail = run.catch(() => {}); return run;
  };
  return { transaction, fail: () => { failCommit = true; }, events: () => structuredClone(events) };
}
test("concurrent same-step claims can make at most one external write", async () => {
  const db = fakeDatabase(), ledger = createPilotLedger(db.transaction, scope); let writes = 0;
  const write = async () => { writes++; return { id: "123456789012" }; };
  const settled = await Promise.allSettled([ledger.perform("adset", write), ledger.perform("adset", write)]);
  assert.ok(settled.some(r => r.status === "fulfilled")); assert.equal(writes, 1);
  await ledger.perform("adset", write); assert.equal(writes, 1);
});
test("provider timeout or confirmation-COMMIT failure leaves a durable intent and blocks replay", async () => {
  for (const timeout of [true, false]) {
    const db = fakeDatabase(), ledger = createPilotLedger(db.transaction, scope); let writes = 0;
    if (!timeout) db.fail();
    const write = async () => { writes++; if (timeout) throw Error("timeout after possible acceptance"); return { id: "123456789012" }; };
    await assert.rejects(ledger.perform("adset", write), PilotReconciliationRequired);
    await assert.rejects(ledger.perform("adset", write), PilotReconciliationRequired);
    await assert.rejects(ledger.snapshot(), PilotReconciliationRequired);
    assert.equal(writes, 1); assert.deepEqual(db.events().map(e => e.kind), ["intent"]);
  }
});
test("a durable stop revokes later stage and activate commands", async () => {
  const db = fakeDatabase(), ledger = createPilotLedger(db.transaction, scope); let writes = 0;
  await ledger.revoke();
  await assert.rejects(ledger.perform("activate_campaign", async () => { writes++; return { id: PILOT.campaign }; }), /STOP_REVIEW/);
  assert.equal(writes, 0); await assert.rejects(ledger.snapshot(), /STOP_REVIEW/);
});

const origin = "https://preview.example", endpoint = origin + "/api/internal/demand-meta-pilot";
function http(overrides = {}) {
  const calls = [];
  const service = { readiness: async () => ({ checked: true }), stage: async () => { calls.push("stage"); return {}; },
    activate: async () => { calls.push("activate"); return {}; }, pause: async () => { calls.push("pause"); return {}; } };
  const handle = createPilotHttpHandler({ enabled: () => true, authorize: async () => scope,
    service: () => service, ...overrides }); return { handle, calls, service };
}
const token = { Authorization: "Bearer synthetic.jwt.value" };
test("HTTP admission rejects missing identity, forged scope, wrong origin, methods and arbitrary IDs before writes", async () => {
  const h = http();
  const form = () => { const f = new FormData(); f.set("action", "pause"); return f; };
  const requests = [new Request(endpoint), new Request(endpoint, { method: "DELETE", headers: token }),
    new Request(endpoint + "?campaign=999999", { headers: token }),
    new Request(endpoint, { headers: { ...token, "x-tenant-id": scope.tenantId } }),
    new Request(endpoint, { method: "POST", headers: { ...token, Origin: "https://evil.invalid" }, body: form() })];
  for (const req of requests) { const r = await h.handle(req); assert.ok([400, 401, 405].includes(r.status));
    assert.match(r.headers.get("cache-control"), /no-store/); }
  assert.deepEqual(h.calls, []);
  const denied = http({ authorize: async () => { throw Error("private credential-bearing exception"); } });
  const r = await denied.handle(new Request(endpoint, { headers: token })); assert.equal(r.status, 403);
  assert.ok(!(await r.text()).includes("credential-bearing"));
});
test("HTTP admits only a fixed-parent stop and rejects client-supplied campaign or approval fields", async () => {
  const h = http();
  for (const extra of [false, true]) {
    const f = new FormData(); f.set("action", "pause"); if (extra) f.set("campaignId", "999999999999");
    const r = await h.handle(new Request(endpoint, { method: "POST", headers: { ...token, Origin: origin }, body: f }));
    assert.equal(r.status, extra ? 400 : 200);
  }
  assert.deepEqual(h.calls, ["pause"]);
});
test("HTTP reports unknown provider persistence explicitly without exposing the exception", async () => {
  const h = http(); h.service.pause = async () => { throw new PilotReconciliationRequired(); };
  const f = new FormData(); f.set("action", "pause");
  const r = await h.handle(new Request(endpoint, { method: "POST", headers: { ...token, Origin: origin }, body: f }));
  assert.equal(r.status, 409); assert.equal((await r.json()).reconcileRequired, true);
});

test("HTTP permits image-free resume and forwards no synthetic image bytes", async () => {
  const h = http();
  const form = new FormData(); form.set("action", "stage");
  const r = await h.handle(new Request(endpoint, {
    method: "POST", headers: { ...token, Origin: origin }, body: form,
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls, ["stage"]);
});
test("uncommitted image stage rejects missing image bytes before Meta writes", async () => {
  const f = fixture();
  for (const step of STAGE_STEPS) delete f.snapshot[step];
  f.emptyChildren();
  await assert.rejects(service(f).stage(scope, {}), /APPROVED_V5_ASSET_REQUIRED/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});

test("missing journaled image with existing ads requires reconciliation before any write", async () => {
  const f = fixture(); delete f.snapshot.image_a;
  await assert.rejects(service(f).stage(scope, {}), /AD_CREATIVE_READBACK_MISMATCH/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});

test("readable but mismatched objects or identities never authorize stage or activation", async () => {
  for (const mutate of [
    f => { f.set.ads.data[0].creative.object_story_spec.link_data.image_hash = "0".repeat(32); },
    f => { f.set.regional_regulation_identities.universal_payer = "99999999000003"; },
  ]) {
    const f = fixture(); mutate(f);
    const r = await service(f).readiness(scope);
    assert.equal(r.providerVerified, true);
    assert.equal(r.canStage, false); assert.equal(r.canActivate, false);
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
  }
});

