import test from "node:test";
import assert from "node:assert/strict";
import {normalizeContentInstanceConfig,planContentJobCandidate} from "../lib/content/instance-plan.mjs";
const config=()=>({
  schemaVersion:1,product:"content",tenantId:"tenant-A",instanceId:"instance-A",
  brand:{displayName:"Independent Florist",voice:"Helpful and precise",
    locale:"ms-MY",claimCandidates:["Same-day delivery possible","Fresh flowers"],
    blockedClaims:["Guaranteed revenue"]},
  audience:{segment:"Local gift buyers",needs:["Clear collection options","Delivery lead times"]},
  goals:["Explain ordering steps","Answer common questions"],
  channels:[{service:"instagram",channelId:"ig-A"},{service:"facebook",channelId:"fb-A"}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}
});
const brief=()=>({briefId:"brief-001",revisionId:"rev-1",
  channelService:"instagram",channelId:"ig-A",format:"carousel",assetCount:3,
  topic:"How to order flowers",hypothesis:"Clarity may reduce confusion",
  hook:"Which flowers suit the occasion?",
  measurementQuestion:"Are saves recorded at the same post age?"});
test("universal non-SELL instance yields nonexecuting draft plan",()=>{
  const result=planContentJobCandidate(config(),brief());
  assert.equal(result.status,"PLANNED_ONLY");
  assert.equal(result.independentImagesRequired,3);
  for(const field of ["sourceBytesVerified","visualQaVerified","claimEvidenceVerified",
    "approvalVerified","providerCapabilityVerified","providerSentVerified",
    "measurementVerified","sharedBciAuditVerified","executionAllowed","customerSaasReady"])
    assert.equal(result[field],false);
  assert.equal(result.product,"content");
});
test("stable plan identity survives unordered configuration sets and replay",()=>{
  const a=config(),b=config();
  b.goals.reverse();b.channels.reverse();b.brand.claimCandidates.reverse();
  b.audience.needs.reverse();
  assert.equal(normalizeContentInstanceConfig(a).configSha256,
    normalizeContentInstanceConfig(b).configSha256);
  assert.equal(planContentJobCandidate(a,brief()).planId,
    planContentJobCandidate(b,brief()).planId);
});
test("changed tenant, revision, channel and content produce distinct plan IDs",()=>{
  const base=planContentJobCandidate(config(),brief()).planId;
  const c=config();c.tenantId="tenant-B";
  assert.notEqual(base,planContentJobCandidate(c,brief()).planId);
  const b=brief();b.revisionId="rev-2";
  assert.notEqual(base,planContentJobCandidate(config(),b).planId);
  const d=brief();d.hook="Another relevant question";
  assert.notEqual(base,planContentJobCandidate(config(),d).planId);
  const e=brief();e.channelService="facebook";e.channelId="fb-A";
  assert.notEqual(base,planContentJobCandidate(config(),e).planId);
});
test("unconfigured or unsupported channels are held before any provider action",()=>{
  const b=brief();b.channelId="ig-B";
  assert.throws(()=>planContentJobCandidate(config(),b),/CONTENT_CHANNEL_NOT_CONFIGURED/);
  const c=config();c.channels[0].service="threads";
  assert.throws(()=>normalizeContentInstanceConfig(c),/UNSUPPORTED_CONTENT_CHANNEL/);
});
test("format and independent image count must agree",()=>{
  for(const count of [0,1,21,2.5]){const b=brief();b.assetCount=count;
    assert.throws(()=>planContentJobCandidate(config(),b),/INVALID_CONTENT_MEDIA_PLAN/);}
  const b=brief();b.format="single_image";b.assetCount=1;
  assert.equal(planContentJobCandidate(config(),b).independentImagesRequired,1);
  b.assetCount=2;
  assert.throws(()=>planContentJobCandidate(config(),b),/INVALID_CONTENT_MEDIA_PLAN/);
});
test("approval, source-byte QA and claim-evidence safety policy cannot be disabled",()=>{
  for(const key of Object.keys(config().policy)){
    const c=config();c.policy[key]=false;
    assert.throws(()=>normalizeContentInstanceConfig(c),/CONTENT_SAFETY_POLICY_REQUIRED/);
  }
});
test("rejects hidden, symbol and unknown config and brief keys",()=>{
  const c=config();c[Symbol("unreviewed")]=true;
  assert.throws(()=>normalizeContentInstanceConfig(c),/INVALID_CONTENT_CONFIG_FIELDS/);
  const d=config();Object.defineProperty(d.brand,"hidden",{value:true});
  assert.throws(()=>normalizeContentInstanceConfig(d),/INVALID_CONTENT_BRAND_FIELDS/);
  const b=brief();b.providerApproved=true;
  assert.throws(()=>planContentJobCandidate(config(),b),/INVALID_CONTENT_BRIEF_FIELDS/);
});
test("rejects duplicate channels, duplicate claims and sparse arrays",()=>{
  const c=config();c.channels.push({...c.channels[0]});
  assert.throws(()=>normalizeContentInstanceConfig(c),/DUPLICATE_CONTENT_CHANNELS/);
  const d=config();d.brand.claimCandidates.push(d.brand.claimCandidates[0]);
  assert.throws(()=>normalizeContentInstanceConfig(d),/DUPLICATE_CONTENT_CLAIMS/);
  const e=config();e.goals=new Array(2);
  assert.throws(()=>normalizeContentInstanceConfig(e),/INVALID_CONTENT_GOALS/);
});
test("rejects coercible IDs, malformed text, and client attestation injection",()=>{
  const c=config();c.tenantId=["tenant-A"];
  assert.throws(()=>normalizeContentInstanceConfig(c),/INVALID_CONTENT_TENANT_ID/);
  const b=brief();b.topic="Unverified\nline";
  assert.throws(()=>planContentJobCandidate(config(),b),/INVALID_CONTENT_TOPIC/);
  const d=brief();d.approvalVerified=true;
  assert.throws(()=>planContentJobCandidate(config(),d),/INVALID_CONTENT_BRIEF_FIELDS/);
});

test("accessor-backed config, nested brand, channel and brief fields fail before getter execution",()=>{
  const cases=[
    ()=>{const c=config();Object.defineProperty(c,"tenantId",{enumerable:true,get(){throw Error("EXECUTED_GETTER");}});return ()=>normalizeContentInstanceConfig(c);},
    ()=>{const c=config();Object.defineProperty(c.brand,"voice",{enumerable:true,get(){throw Error("EXECUTED_GETTER");}});return ()=>normalizeContentInstanceConfig(c);},
    ()=>{const c=config();Object.defineProperty(c.channels[0],"service",{enumerable:true,get(){throw Error("EXECUTED_GETTER");}});return ()=>normalizeContentInstanceConfig(c);},
    ()=>{const b=brief();Object.defineProperty(b,"revisionId",{enumerable:true,get(){throw Error("EXECUTED_GETTER");}});return ()=>planContentJobCandidate(config(),b);}
  ];
  for(const make of cases)
    assert.throws(make(),/INVALID_CONTENT_(CONFIG|BRAND|CHANNEL|BRIEF)_FIELDS/);
});
test("accessor-backed array elements and hidden required fields cannot influence stable IDs",()=>{
  const a=config();Object.defineProperty(a.goals,"0",{enumerable:true,configurable:true,
    get(){throw Error("EXECUTED_GETTER");}});
  assert.throws(()=>normalizeContentInstanceConfig(a),/INVALID_CONTENT_GOALS/);
  const b=config();Object.defineProperty(b.channels,"0",{enumerable:true,configurable:true,
    get(){throw Error("EXECUTED_GETTER");}});
  assert.throws(()=>normalizeContentInstanceConfig(b),/INVALID_CONTENT_CHANNELS/);
  const c=config();Object.defineProperty(c.policy,"requiresContentApproval",{
    enumerable:false,configurable:true,value:true});
  assert.throws(()=>normalizeContentInstanceConfig(c),/INVALID_CONTENT_POLICY_FIELDS/);
  assert.equal(planContentJobCandidate(config(),brief()).planId,
    planContentJobCandidate(config(),brief()).planId);
});
