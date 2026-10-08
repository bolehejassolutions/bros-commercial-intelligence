import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetaInsight, fetchMetaReadOnlyInsights } from "../lib/marketing-operator/meta-readonly.ts";

const base = {
  campaign_id: "120250864977630697",
  campaign_name: "BROSSELL | Sales | Static | MY",
  date_start: "2026-10-08",
  date_stop: "2026-10-08",
  spend: "1.15",
  impressions: "94",
  inline_link_clicks: "7",
  actions: [{ action_type: "landing_page_view", value: "3" }],
};
test("normalizes a sourced Meta read-only insight with unknown purchases", () => {
  const result = normalizeMetaInsight(base, "act_1997776120879476", "2026-10-09T01:00:00Z");
  assert.ok(result);
  assert.equal(result.snapshot.spendMYR, 1.15);
  assert.equal(result.snapshot.linkClicks, 7);
  assert.equal(result.snapshot.landingPageViews, 3);
  assert.equal(result.snapshot.purchases, null);
  assert.equal(result.snapshot.attributedRevenueMYR, null);
});
test("rejects campaigns outside BROS SELL Malaysia naming allowlist", () => {
  assert.equal(normalizeMetaInsight({...base,campaign_name:"DEEP CLEANING MY"}, "act_1997776120879476", "2026-10-09T01:00:00Z"), null);
});
test("does not add duplicate purchase action categories", () => {
  const result=normalizeMetaInsight({...base, actions:[{action_type:"offsite_conversion.fb_pixel_purchase",value:"2"},{action_type:"purchase",value:"2"}],action_values:[{action_type:"offsite_conversion.fb_pixel_purchase",value:"200"}]}, "act_1997776120879476", "2026-10-09T01:00:00Z");
  assert.equal(result.snapshot.purchases,2);
  assert.equal(result.snapshot.attributedRevenueMYR,200);
});
test("invalid or missing required evidence fails closed", () => {
  assert.throws(()=>normalizeMetaInsight({...base,impressions:"-1"},"act_1997776120879476","2026-10-09T01:00:00Z"));
  assert.throws(()=>normalizeMetaInsight({...base,inline_link_clicks:undefined},"act_1997776120879476","2026-10-09T01:00:00Z"));
  assert.throws(()=>normalizeMetaInsight({...base,campaign_id:"evil"},"act_1997776120879476","2026-10-09T01:00:00Z"));
});
test("GET-only Graph client sends Bearer header, fixed fields and no spend operation", async () => {
  const calls=[];
  const mock=async (url,opts)=>{
    calls.push({url,opts});
    return new Response(JSON.stringify({data:[base]}),{status:200,headers:{"content-type":"application/json"}});
  };
  const rows=await fetchMetaReadOnlyInsights("act_1997776120879476","read-token-0123456789","2026-10-08","2026-10-08",mock);
  assert.equal(rows.length,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].opts.method,"GET");
  assert.equal(calls[0].opts.headers.Authorization,"Bearer read-token-0123456789");
  assert.ok(calls[0].url.startsWith("https://graph.facebook.com/v24.0/act_1997776120879476/insights?"));
  assert.ok(!calls[0].url.includes("read-token"));
});
test("rejects malicious pagination destination and oversized read windows", async () => {
  const mock=async ()=> new Response(JSON.stringify({data:[base],paging:{next:"https://example.com/leak"}}),{status:200});
  await assert.rejects(()=>fetchMetaReadOnlyInsights("act_1997776120879476","read-token-0123456789","2026-10-08","2026-10-08",mock),/pagination destination/);
  await assert.rejects(()=>fetchMetaReadOnlyInsights("act_1997776120879476","read-token-0123456789","2026-10-01","2026-10-08",mock),/Max read window/);
});
test("rate limit fails instead of retrying indefinitely", async () => {
  let count=0;
  const mock=async ()=>{count++;return new Response("{}",{status:429})};
  await assert.rejects(()=>fetchMetaReadOnlyInsights("act_1997776120879476","read-token-0123456789","2026-10-08","2026-10-08",mock),/rate limit/);
  assert.equal(count,1);
});
