import { createHmac } from "node:crypto";
import { metaCreatePaused, metaSetStatus, requireExclusiveCampaignDelivery } from "../marketing-operator/meta-write.ts";
import { metaProviderRequest, metaProviderJson } from "../marketing-operator/meta-provider.ts";
import { PILOT, ASSETS, type Snapshot, type StepResult, adsetBody, creativeBody } from "./meta-pilot-policy.ts";

const GRAPH = "https://graph.facebook.com/v24.0";
type RecordValue = Record<string, unknown>;
function object(v: unknown): RecordValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("META_READBACK_INVALID");
  return v as RecordValue;
}
const number = (v: unknown): number => typeof v === "string" && /^\d+$/.test(v) ? Number(v) :
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : NaN;
const id = (v: unknown): string => { if (typeof v !== "string" || !/^\d{6,30}$/.test(v)) throw Error("META_OBJECT_ID_REQUIRED"); return v; };
const exactList = (v: unknown, expected: readonly string[]) => Array.isArray(v) &&
  v.length === expected.length && v.every(x => typeof x === "string") &&
  [...v].sort().join("|") === [...expected].sort().join("|");
function list(v: unknown): RecordValue[] {
  const p = object(v);
  if (!Array.isArray(p.data) || p.data.length > 20 ||
      (p.paging && object(p.paging).next)) throw Error("META_COLLECTION_NOT_COMPLETE");
  return p.data.map(object);
}
export type PilotProviderState = { campaign: RecordValue; adsets: RecordValue[]; account: RecordValue };

/** Reuses the existing Meta write adapter; no new account, backend or campaign creator. */
export function createPilotProvider(token: string, rawTransport: typeof fetch = fetch, appSecret?: string) {
  const proof = appSecret ? createHmac("sha256", appSecret).update(token).digest("hex") : null;
  const transport: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://graph.facebook.com") throw Error("META_DESTINATION_DENIED");
    if (proof) url.searchParams.set("appsecret_proof", proof);
    return rawTransport(url.toString(), init);
  };
  const safeFetch: typeof fetch = (input, init) => metaProviderRequest(String(input), init ?? {}, transport);
  async function get(path: string, fields: string) {
    const url = new URL(GRAPH + "/" + path); url.searchParams.set("fields", fields);
    if (path.endsWith("/adsets")) url.searchParams.set("limit", "20");
    if (path.endsWith("/insights")) url.searchParams.set("date_preset", "maximum");
    const response = await metaProviderRequest(url.toString(), { method: "GET", cache: "no-store",
      headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) }, transport);
    const data = await metaProviderJson(response);
    if (!response.ok || data.error) throw Error("META_READBACK_UNAVAILABLE");
    return data;
  }
  async function read(): Promise<PilotProviderState> {
    const [account, campaign, children] = await Promise.all([
      get(PILOT.account, "id,account_id,account_status,currency,timezone_name"),
      get(PILOT.campaign, "id,account_id,name,status,effective_status,objective,lifetime_budget,daily_budget,budget_remaining,spend_cap"),
      get(PILOT.campaign + "/adsets", "id,account_id,campaign_id,status,effective_status,start_time,end_time,lifetime_budget,daily_budget,optimization_goal,destination_type,promoted_object,targeting,regional_regulated_categories,regional_regulation_identities,ads.limit(20){id,status,effective_status,adset_id,issues_info,creative{id,object_story_spec}}"),
    ]);
    if (account.id !== PILOT.account || account.account_id !== PILOT.account.slice(4) ||
        account.account_status !== 1 || account.currency !== "MYR" || account.timezone_name !== "Asia/Kuala_Lumpur")
      throw Error("META_ACCOUNT_SETTINGS_MISMATCH");
    if (campaign.id !== PILOT.campaign || campaign.account_id !== PILOT.account.slice(4) ||
        campaign.objective !== "OUTCOME_SALES" || number(campaign.lifetime_budget) !== PILOT.budgetMinor ||
        (campaign.daily_budget !== undefined && number(campaign.daily_budget) !== 0) ||
        !Number.isFinite(number(campaign.budget_remaining)) || number(campaign.budget_remaining) > PILOT.budgetMinor ||
        (campaign.spend_cap !== undefined && number(campaign.spend_cap) !== 0 &&
          !(number(campaign.spend_cap) > 0 && number(campaign.spend_cap) <= PILOT.budgetMinor)))
      throw Error("EXISTING_CAMPAIGN_AUTHORITY_MISMATCH");
    const adsets = list(children);
    // Nested ads are paginated independently of campaign adsets. Never treat
    // a truncated nested collection as a complete externally managed flight:
    // that could hide extra ads while the operator reports a verified V5 set.
    for (const set of adsets) {
      if (set.ads !== undefined) list(set.ads);
    }
    return { account, campaign, adsets };
  }
  function assertPaused(state: PilotProviderState) {
    if (state.campaign.status !== "PAUSED" || number(state.campaign.budget_remaining) !== PILOT.budgetMinor)
      throw Error("UNSPENT_PAUSED_CAMPAIGN_REQUIRED");
  }
  function assertObjects(state: PilotProviderState, snapshot: Snapshot, complete: boolean, at: number) {
    const known = snapshot.adset?.id;
    if (state.adsets.length !== (known ? 1 : 0)) throw Error("CAMPAIGN_CHILDREN_REQUIRE_RECONCILIATION");
    if (!known) { if (complete) throw Error("PAUSED_STAGING_INCOMPLETE"); return; }
    const set = state.adsets[0];
    const target = object(set.targeting), geo = object(target.geo_locations), promoted = object(set.promoted_object);
    const flight = snapshot.refresh_flight ?? snapshot.adset;
    if (set.id !== known || set.campaign_id !== PILOT.campaign || set.account_id !== PILOT.account.slice(4) ||
        set.status !== (snapshot.activate_adset ? "ACTIVE" : "PAUSED") ||
        !exactList(geo.countries, ["MY"]) || ["regions", "cities", "country_groups", "custom_locations", "zips"].some(k => k in geo) ||
        target.age_min !== 21 || target.age_max !== 45 ||
        !exactList(target.publisher_platforms, ["facebook", "instagram"]) ||
        !exactList(target.facebook_positions, ["feed"]) || !exactList(target.instagram_positions, ["stream"]) ||
        object(target.targeting_automation).advantage_audience !== 0 ||
        promoted.pixel_id !== PILOT.pixel || promoted.custom_event_type !== "PURCHASE" ||
        set.optimization_goal !== "OFFSITE_CONVERSIONS" || set.destination_type !== "WEBSITE" ||
        (set.daily_budget !== undefined && number(set.daily_budget) !== 0) ||
        (set.lifetime_budget !== undefined && number(set.lifetime_budget) !== 0) ||
        Date.parse(String(set.start_time)) !== Date.parse(flight!.start!) ||
        Date.parse(String(set.end_time)) !== Date.parse(flight!.end!) ||
        Date.parse(String(set.end_time)) - Date.parse(String(set.start_time)) !== PILOT.durationSeconds * 1000)
      throw Error("ADSET_READBACK_MISMATCH");
    const ads = list(set.ads);
    const expected = [snapshot.ad_a?.id, snapshot.ad_b?.id].filter(Boolean);
    if (ads.length !== expected.length || ads.some(ad => !expected.includes(String(ad.id))))
      throw Error("AD_CHILDREN_REQUIRE_RECONCILIATION");
    for (const key of ["a", "b"] as const) {
      const adId = snapshot[key === "a" ? "ad_a" : "ad_b"]?.id;
      if (!adId) { if (complete) throw Error("PAUSED_STAGING_INCOMPLETE"); continue; }
      const ad = ads.find(x => x.id === adId)!;
      const creative = object(ad.creative), story = object(creative.object_story_spec), link = object(story.link_data);
      const a = ASSETS[key];
      if (ad.adset_id !== known || ad.status !== (snapshot[key === "a" ? "activate_ad_a" : "activate_ad_b"] ? "ACTIVE" : "PAUSED") ||
          creative.id !== snapshot[key === "a" ? "creative_a" : "creative_b"]?.id ||
          story.page_id !== PILOT.page || link.link !== a.url || link.message !== a.text ||
          link.name !== a.headline || link.description !== a.description ||
          link.image_hash !== snapshot[key === "a" ? "image_a" : "image_b"]?.hash ||
          object(link.call_to_action).type !== "LEARN_MORE" ||
          object(object(link.call_to_action).value).link !== a.url ||
          (complete && Array.isArray(ad.issues_info) && ad.issues_info.length > 0) ||
          (complete && !["PAUSED", "ACTIVE", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(String(ad.effective_status))))
        throw Error("AD_CREATIVE_READBACK_MISMATCH");
    }
    if (complete && snapshot.refresh_flight && (Date.parse(String(set.start_time)) <= at ||
        Date.parse(String(set.end_time)) <= at)) throw Error("FLIGHT_DATES_EXPIRED_RECONCILE_REQUIRED");
  }
  async function spendReadback(): Promise<{ source: "META_GRAPH_INSIGHTS"; spendMinor: number | null; window: string; status: "REPORTED" | "NO_ROWS" }> {
    // Meta Insights can return no rows before delivery. No rows are not reported zero spend.
    const response = await get(PILOT.campaign + "/insights", "spend,date_start,date_stop");
    const rows = list(response);
    if (rows.length === 0) return { source: "META_GRAPH_INSIGHTS", spendMinor: null, window: "lifetime", status: "NO_ROWS" };
    if (rows.length !== 1 || typeof rows[0].spend !== "string" ||
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(rows[0].spend))
      throw Error("META_INSIGHTS_UNVERIFIED");
    const [whole, fraction = ""] = rows[0].spend.split(".");
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(minor) || minor < 0) throw Error("META_INSIGHTS_UNVERIFIED");
    return { source: "META_GRAPH_INSIGHTS", spendMinor: minor, window: "lifetime", status: "REPORTED" };
  }
  return {
    read, spendReadback, assertPaused, assertObjects,
    assertIdentities(state: PilotProviderState, expected: Parameters<typeof adsetBody>[0]) {
      if (!state.adsets.length) return;
      const identities = object(state.adsets[0].regional_regulation_identities);
      if (!exactList(state.adsets[0].regional_regulated_categories, ["MALAYSIA_UNIVERSAL"]) ||
          identities.universal_beneficiary !== expected.universal_beneficiary ||
          identities.universal_payer !== expected.universal_payer) throw Error("MALAYSIA_IDENTITY_READBACK_MISMATCH");
    },
    async upload(bytes: Uint8Array) {
      const body = new URLSearchParams({ bytes: Buffer.from(bytes).toString("base64") });
      const response = await metaProviderRequest(GRAPH + "/" + PILOT.account + "/adimages", {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded" },
        body, cache: "no-store", signal: AbortSignal.timeout(16000),
      }, transport);
      const data = await metaProviderJson(response);
      const images = Object.values(object(data.images));
      const image = images.length === 1 ? object(images[0]) : null;
      if (!response.ok || data.error || !image || typeof image.hash !== "string" || !/^[a-f0-9]{32}$/i.test(image.hash))
        throw Error("META_IMAGE_UPLOAD_UNCONFIRMED");
      return { hash: image.hash } satisfies StepResult;
    },
    async createAdset(identities: Parameters<typeof adsetBody>[0], now: number) {
      const body = adsetBody(identities, now);
      return { id: await metaCreatePaused(PILOT.account, "adsets", body, token, safeFetch),
        start: body.start_time, end: body.end_time } satisfies StepResult;
    },
    async createCreative(key: "a" | "b", hash: string) {
      return { id: await metaCreatePaused(PILOT.account, "adcreatives", creativeBody(key, hash), token, safeFetch) };
    },
    async createAd(key: "a" | "b", setId: string, creativeId: string) {
      return { id: await metaCreatePaused(PILOT.account, "ads", {
        name: "BROS SELL | APPROVED V5 | " + key.toUpperCase(), adset_id: id(setId),
        creative: { creative_id: id(creativeId) }, status: "PAUSED",
      }, token, safeFetch) };
    },
    async activate(objectId: string) { await metaSetStatus(id(objectId), "ACTIVE", token, safeFetch); return { id: objectId, status: "ACTIVE" }; },
    async refreshFlight(setId: string, now: number) {
      const start = new Date(now + 5 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
      const end = new Date(Date.parse(start) + PILOT.durationSeconds * 1000).toISOString();
      const response = await metaProviderRequest(GRAPH + "/" + id(setId), {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ start_time: start, end_time: end }), cache: "no-store", signal: AbortSignal.timeout(16000),
      }, transport);
      const data = await metaProviderJson(response);
      if (!response.ok || data.success !== true) throw Error("FLIGHT_UPDATE_UNCONFIRMED");
      return { id: setId, start, end };
    },
    async pause() {
      // Stop control is fixed to the approved parent; no budget, dates or children are changed.
      await metaSetStatus(PILOT.campaign, "PAUSED", token, safeFetch);
      const current = await get(PILOT.campaign, "id,account_id,status");
      if (current.id !== PILOT.campaign || current.account_id !== PILOT.account.slice(4) || current.status !== "PAUSED")
        throw Error("PAUSE_READBACK_UNCONFIRMED");
      return { id: PILOT.campaign, status: "PAUSED" };
    },
    exclusive: () => requireExclusiveCampaignDelivery(PILOT.campaign, token, safeFetch),
  };
}
