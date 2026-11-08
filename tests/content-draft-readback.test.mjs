import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmContentDraftReadback,ContentDraftReadbackUnverified} from '../lib/content/neon-content-draft-readback.ts';
const workspace='22222222-2222-4222-8222-222222222222';
const otherWorkspace='33333333-3333-4333-8333-333333333333';
const campaign='44444444-4444-4444-8444-444444444444';
const otherCampaign='55555555-5555-4555-8555-555555555555';
const submitted={product_service:'BROS SELL',audience:'Malaysian SMEs',description:'Campaign brief',problem:'Unclear value',objective:'Educate',duration_days:7,platforms:['facebook','tiktok']};
const stored=(changes={})=>({id:campaign,status:'draft',...submitted,...changes});
const payload=(campaigns)=>({data:{workspace:{id:workspace,name:'DEV workspace'},campaigns,contentItems:[],scenes:[]}});
const confirm=(rows,expected=submitted)=>confirmContentDraftReadback(payload(rows),workspace,campaign,expected);
test('independent persisted draft readback confirms exact draft id, workspace and fields',()=>{
 const data=confirm([stored()]);
 assert.equal(data.campaigns[0].id,campaign);
});
test('201 receipt with no readable campaign is not success',()=>{
 assert.throws(()=>confirm([]),ContentDraftReadbackUnverified);
});
test('different campaign or non-draft status never confirms a write',()=>{
 assert.throws(()=>confirm([stored({id:otherCampaign})]),ContentDraftReadbackUnverified);
 assert.throws(()=>confirm([stored({status:'published'})]),ContentDraftReadbackUnverified);
});
test('workspace mismatch, malformed or truncated response fails closed',()=>{
 assert.throws(()=>confirmContentDraftReadback(payload([stored()]),otherWorkspace,campaign,submitted),ContentDraftReadbackUnverified);
 assert.throws(()=>confirmContentDraftReadback({data:{workspace:{id:workspace,name:'DEV workspace'},campaigns:[],contentItems:[]}},workspace,campaign,submitted),ContentDraftReadbackUnverified);
 assert.throws(()=>confirmContentDraftReadback(null,workspace,campaign,submitted),ContentDraftReadbackUnverified);
});
test('duplicate campaign ids fail strict validation before receipt confirmation',()=>{
 assert.throws(()=>confirm([stored(),stored()]),ContentDraftReadbackUnverified);
});
test('matching ID/status with changed persisted brief is NOT successful readback',()=>{
 for(const change of [
  {product_service:'Different brand'},{audience:'Different tenant audience'},
  {description:'Altered'},{problem:'Altered'},{objective:'Altered'},
  {duration_days:8},{platforms:['facebook']},{platforms:['tiktok','facebook']},
  {platforms:['facebook','instagram']}
 ]){
  assert.throws(()=>confirm([stored(change)]),ContentDraftReadbackUnverified,JSON.stringify(change));
 }
});
test('server normalization of required text and platform casing is respected',()=>{
 const input={...submitted,product_service:'  BROS SELL  ',audience:'  Malaysian SMEs  ',platforms:['Facebook','TikTok']};
 assert.equal(confirm([stored()],input).campaigns.length,1);
});
test('missing stored fields cannot be mistaken for an intact brief',()=>{
 const row=stored();delete row.description;
 assert.throws(()=>confirm([row]),ContentDraftReadbackUnverified);
 assert.throws(()=>confirm([stored()],null),ContentDraftReadbackUnverified);
});

test('in-flight form edits do not invalidate the immutable submitted draft readback',()=>{
 const editable={...submitted,platforms:[...submitted.platforms]};
 const submittedBody=JSON.stringify(editable);
 const submittedSnapshot=JSON.parse(submittedBody);
 // Mimics a user editing the form after POST begins but before the independent GET.
 editable.audience='Changed while saving';
 editable.platforms.push('instagram');
 assert.equal(confirm([stored()],submittedSnapshot).campaigns.length,1);
 assert.throws(()=>confirm([stored()],editable),ContentDraftReadbackUnverified);
 assert.equal(submittedBody,JSON.stringify(submittedSnapshot));
});
test('the captured request snapshot cannot silently confirm a different persisted brief',()=>{
 const editable={...submitted};
 const snapshot=JSON.parse(JSON.stringify(editable));
 editable.problem='Updated after request dispatch';
 assert.throws(()=>confirm([stored({problem:'Unexpected server mutation'})],snapshot),ContentDraftReadbackUnverified);
});
