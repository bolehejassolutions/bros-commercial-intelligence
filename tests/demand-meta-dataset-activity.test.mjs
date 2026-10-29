import test from "node:test";
import assert from "node:assert/strict";
import { assessDemandMetaDatasetActivity as assess } from "../lib/demand/meta-dataset-activity.ts";

// Provider-observed Meta dataset inventory SHAPE and timestamps, 29 Oct 2026.
// This fixture is not an authenticated DEMAND app event readback.
const account = "act_1997776120879476";
const pixel = "1636131111400103";
const dataset = {id:pixel,name:"BROS SELL Web Dataset",
  last_fired_time:"2026-10-28T08:28:18+0800",
  creation_time:"2026-10-05T22:08:38+0800",is_unavailable:false};
const inventory = rows => ({rows,nextPageToken:null,missingScopes:null});
const run = rows => assess(account,pixel,inventory(rows));

test("real provider-shaped dataset timestamp is NOT a purchase or test event",()=>{
  const r=run([dataset]);
  assert.equal(r.state,"ACTIVITY_TIMESTAMP_REPORTED_EVENT_UNVERIFIED");
  assert.equal(r.lastDatasetActivityTimeUtc,"2026-10-28T00:28:18.000Z");
  assert.equal(r.datasetCreationTimeUtc,"2026-10-05T14:08:38.000Z");
  assert.equal(r.datasetAvailableAtReadback,true);
  for(const key of ["datasetActivityEventType","testEventCount","livePurchaseEventCount",
    "verifiedSettledOrders","verifiedCpaMinor","verifiedCacMinor",
    "verifiedConversionRate","verifiedAcquisitionOutcome"]){assert.equal(r[key],null);}
  assert.equal(r.campaignDatasetLinkVerified,false);
  assert.equal(r.providerAuthenticationVerifiedForDemandApp,false);
  assert.equal(r.durableBciLearningVerified,false);
  assert.equal(JSON.stringify(r).includes(pixel),false);
});

test("stable fingerprint across inventory order; new activity changes identity",()=>{
  const other={...dataset,id:"1636131111400104",name:"unrelated"};
  assert.equal(run([dataset,other]).snapshotKey,run([other,dataset]).snapshotKey);
  const updated=run([{...dataset,last_fired_time:"2026-10-29T08:28:18+0800"}]);
  assert.notEqual(updated.snapshotKey,run([dataset]).snapshotKey);
  assert.equal(updated.livePurchaseEventCount,null);
});

test("unavailable, missing timestamp and missing dataset remain unverified",()=>{
  assert.equal(run([{...dataset,is_unavailable:true}]).state,"DATASET_UNAVAILABLE_AT_READBACK");
  assert.equal(run([{...dataset,last_fired_time:null}]).state,"NO_ACTIVITY_TIMESTAMP_RETURNED");
  const missing=run([]);
  assert.equal(missing.state,"DATASET_NOT_IN_COMPLETE_INVENTORY");
  assert.equal(missing.datasetAvailableAtReadback,null);
  assert.equal(missing.verifiedAcquisitionOutcome,null);
});

test("reject partial inventories, duplicate identities, invalid timestamps and missing scope",()=>{
  assert.throws(()=>assess(account,pixel,{...inventory([dataset]),nextPageToken:"next"}));
  assert.throws(()=>assess(account,pixel,{...inventory([dataset]),missingScopes:["ads_read"]}));
  assert.throws(()=>assess(account,pixel,{...inventory([dataset]),droppedFields:["last_fired_time"]}));
  assert.throws(()=>run([dataset,dataset]));
  for(const last_fired_time of ["2026-02-30T08:28:18+0800",
    "2026-10-28T08:28:18+2500","2026-10-28T08:28:18+1460",
    "2026-10-04T08:28:18+0800","not a timestamp"]){
    assert.throws(()=>run([{...dataset,last_fired_time}]));
  }
  assert.throws(()=>run([{...dataset,is_unavailable:"false"}]));
  assert.throws(()=>run([{...dataset,creation_time:null}]));
});
