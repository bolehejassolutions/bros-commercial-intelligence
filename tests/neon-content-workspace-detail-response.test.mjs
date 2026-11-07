import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentWorkspaceDetail,ContentWorkspaceDetailInvalid} from '../lib/content/neon-content-workspace-detail-response.ts';

const W='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const I='44444444-4444-4444-8444-444444444444';
const S='55555555-5555-4555-8555-555555555555';
const foreign='77777777-7777-4777-8777-777777777777';
const payload=()=>({data:{
 workspace:{id:W,name:'Recovered workspace'},
 campaigns:[{id:C,product_service:'BROS SELL',captions:{facebook:'Hello'}}],
 contentItems:[{id:I,campaign_id:C,type:'script',body:{hook:'Example'}}],
 scenes:[{id:S,content_item_id:I,scene_number:1}]
}});
test('valid recovered campaigns, items and scenes retain original display data',()=>{
 const parsed=parseContentWorkspaceDetail(payload(),W);
 assert.equal(parsed.campaigns[0].product_service,'BROS SELL');
 assert.deepEqual(parsed.campaigns[0].captions,{facebook:'Hello'});
 assert.equal(parsed.contentItems[0].campaign_id,C);
 assert.equal(parsed.scenes[0].content_item_id,I);
});
test('genuinely empty authorized workspace remains a valid empty result',()=>{
 const p=payload();p.data.campaigns=[];p.data.contentItems=[];p.data.scenes=[];
 const parsed=parseContentWorkspaceDetail(p,W);
 assert.equal(parsed.campaigns.length,0);
});
test('malformed successful HTTP responses fail closed rather than claiming zero campaigns',()=>{
 for(const p of [null,{}, {data:{}}, {data:{...payload().data,campaigns:null}},
  {data:{...payload().data,scenes:undefined}}, {data:{...payload().data,workspace:{id:W,name:''}}}])
  assert.throws(()=>parseContentWorkspaceDetail(p,W),ContentWorkspaceDetailInvalid);
});
test('wrong workspace, orphan items and orphan scenes fail closed',()=>{
 assert.throws(()=>parseContentWorkspaceDetail(payload(),foreign),ContentWorkspaceDetailInvalid);
 const item=payload();item.data.contentItems[0].campaign_id=foreign;
 assert.throws(()=>parseContentWorkspaceDetail(item,W),ContentWorkspaceDetailInvalid);
 const scene=payload();scene.data.scenes[0].content_item_id=foreign;
 assert.throws(()=>parseContentWorkspaceDetail(scene,W),ContentWorkspaceDetailInvalid);
});
test('duplicate ids across each collection fail closed',()=>{
 for(const field of ['campaigns','contentItems','scenes']){
  const p=payload();p.data[field].push({...p.data[field][0]});
  assert.throws(()=>parseContentWorkspaceDetail(p,W),ContentWorkspaceDetailInvalid);
 }
});
test('missing IDs and invalid workspace input are rejected',()=>{
 const p=payload();p.data.campaigns[0].id='invalid';
 assert.throws(()=>parseContentWorkspaceDetail(p,W),ContentWorkspaceDetailInvalid);
 assert.throws(()=>parseContentWorkspaceDetail(payload(),'invalid'),ContentWorkspaceDetailInvalid);
});
