import test from "node:test";
import assert from "node:assert/strict";
import { readDemandMetaObjectStatus, readDemandMetaStatusSnapshot } from "../lib/demand/meta-status-readonly.ts";
const binding = { accountId: "act_1997776120879476", objectId: "120251158023300697", kind: "campaign", apiVersion: "v26.0" };
const token = "synthetic-token-123456789012345";
const now = "2026-11-09T00:00:00Z";
const row = { id: binding.objectId, account_id: binding.accountId.slice(4), configured_status: "PAUSED", effective_status: "CAMPAIGN_PAUSED" };
const ok = data => async (url, init) => {
  assert.equal(new URL(url).origin, "https://graph.facebook.com");
  assert.equal(new URL(url).pathname, "/v26.0/" + binding.objectId);
  assert.equal(new URL(url).searchParams.get("fields"), "id,account_id,configured_status,effective_status");
  assert.equal(url.includes(token), false);
  assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
  assert.equal(init.headers.Authorization, "Bearer " + token);
  return { ok: true, json: async () => data };
};
const read = (transport, b = binding, t = token, timestamp = now) =>
  readDemandMetaObjectStatus(b,t,timestamp,transport);
const denied = /BROS_DEMAND_META_STATUS_READ_FAILED/;
test("bounded campaign, adset, ad status observation remains read-only and unattested", async () => {
  for (const kind of ["campaign","adset","ad"]) {
    const r = await read(ok(row), { ...binding, kind });
    assert.equal(r.kind, kind); assert.equal(r.configuredStatus,"PAUSED");
    assert.equal(r.effectiveStatus,"CAMPAIGN_PAUSED"); assert.equal(r.observedAt,now);
    assert.equal(r.executionAllowed,false); assert.equal(r.providerAuthorizationIndependentlyAttested,false);
    assert.equal(JSON.stringify(r).includes(token),false); assert.equal(Object.isFrozen(r),true);
  }
});
test("wrong account/object, incomplete statuses, provider error and malformed rows fail closed", async () => {
  for (const body of [null, [], {}, {error:{message:token}}, {...row,account_id:"999"},
    {...row,id:"999"}, {...row,configured_status:"UNKNOWN"}, {...row,effective_status:null},
    {...row,effective_status:"ACTIVE",configured_status:undefined}])
    await assert.rejects(read(ok(body)),denied);
  await assert.rejects(read(async()=>({ok:false,json:async()=>row})),denied);
  await assert.rejects(read(async()=>{throw Error(token)}),denied);
});
test("bad binding, injection, invalid clock and token deny before network", async () => {
  let calls=0; const network=async()=>{calls++;return {ok:true,json:async()=>row}};
  for (const b of [{...binding,objectId:"1/insights"}, {...binding,accountId:"act_bad"},
    {...binding,kind:"creative"}, {...binding,apiVersion:"v26.0?access_token=x"}])
    await assert.rejects(read(network,b),denied);
  for (const t of ["short","bad\nAuthorization: hacked"]) await assert.rejects(read(network,binding,t),denied);
  for (const ts of ["2026-11-31T00:00:00Z","2026-11-09T99:00:00Z","not-a-time"])
    await assert.rejects(read(network,binding,token,ts),denied);
  assert.equal(calls,0);
});

test("bounded snapshot rejects duplicates, mixed tenants and oversized batches before transport", async () => {
  let calls=0;
  const transport=async()=>{calls++;return {ok:true,json:async()=>row}};
  const readBatch=items=>readDemandMetaStatusSnapshot(items,token,now,transport);
  for (const items of [[],Array(21).fill(binding),[binding,binding],
    [binding,{...binding,accountId:"act_1234567890"}],
    [binding,{...binding,kind:"adset"}],
    [binding,{...binding,objectId:"120251158023300698",apiVersion:"v25.0"}],
    [binding,{...binding,apiVersion:"v26.0?fields=unsafe",objectId:"120251158023300698"}],
    [binding,{...binding,kind:"creative",objectId:"120251158023300698"}],
    [binding,{...binding,objectId:"1/insights"}]])
    await assert.rejects(readBatch(items),denied);
  assert.equal(calls,0);
  const result=await readBatch([binding,{...binding,kind:"adset",objectId:"120251158023300698"}]
    .slice(0,1));
  assert.equal(result.rows.length,1);
  assert.equal(result.executionAllowed,false);
  assert.equal(Object.isFrozen(result.rows),true);
  assert.equal(Object.isFrozen(result),true);
});
test("snapshot never returns partial rows after a provider failure",async()=>{
  let calls=0;
  const transport=async()=>{calls++;return {ok:true,json:async()=>calls===1?row:{...row,id:"invalid"}}};
  await assert.rejects(readDemandMetaStatusSnapshot(
    [binding,{...binding,kind:"adset",objectId:"120251158023300698"}],
    token,now,transport),denied);
  assert.equal(calls,2);
});
