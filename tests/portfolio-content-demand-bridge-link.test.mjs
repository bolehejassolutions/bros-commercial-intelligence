import test from "node:test";
import assert from "node:assert/strict";
import {prepareContentDemandBridgeUrl} from "../lib/portfolio/content-demand-bridge-link.ts";

test("one reviewed CONTENT plan can hand a non-secret plan/copy/channel to DEMAND",()=>{
  const url=prepareContentDemandBridgeUrl({
    planId:"content-plan-"+"a".repeat(64),creativeSha256:"b".repeat(64),channelService:"instagram",
  });
  const u=new URL(url);
  assert.equal(u.origin,"https://brosdemand.bolehejas.com");
  assert.equal(u.pathname,"/");
  assert.equal(u.search,"");
  const p=new URLSearchParams(u.hash.slice(1));
  assert.equal(p.get("channel"),"instagram");
  assert.equal(p.get("contentPlanId"),"content-plan-"+"a".repeat(64));
  assert.equal(p.get("creativeSha256"),"b".repeat(64));
  assert.equal([...p.keys()].length,3);
});
test("not a generic open redirect or an unvalidated permission grant",()=>{
  for(const bad of [
    {planId:"x",creativeSha256:"b".repeat(64),channelService:"instagram"},
    {planId:"content-plan-"+"a".repeat(64),creativeSha256:"x",channelService:"instagram"},
    {planId:"content-plan-"+"a".repeat(64),creativeSha256:"b".repeat(64),channelService:"other"},
  ])assert.throws(()=>prepareContentDemandBridgeUrl(bad),/HANDOFF_INVALID/);
});
