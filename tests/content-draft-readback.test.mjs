import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmContentDraftReadback,ContentDraftReadbackUnverified} from '../lib/content/neon-content-draft-readback.ts';
const workspace='22222222-2222-4222-8222-222222222222';
const otherWorkspace='33333333-3333-4333-8333-333333333333';
const campaign='44444444-4444-4444-8444-444444444444';
const otherCampaign='55555555-5555-4555-8555-555555555555';
const payload=(campaigns)=>({data:{workspace:{id:workspace,name:'DEV workspace'},campaigns,contentItems:[],scenes:[]}});
test('independent persisted draft readback confirms exact draft id and workspace',()=>{
 const data=confirmContentDraftReadback(payload([{id:campaign,status:'draft'}]),workspace,campaign);
 assert.equal(data.campaigns[0].id,campaign);
});
test('201 receipt with no readable campaign is not success',()=>{
 assert.throws(()=>confirmContentDraftReadback(payload([]),workspace,campaign),ContentDraftReadbackUnverified);
});
test('different campaign or non-draft status never confirms a write',()=>{
 assert.throws(()=>confirmContentDraftReadback(payload([{id:otherCampaign,status:'draft'}]),workspace,campaign),ContentDraftReadbackUnverified);
 assert.throws(()=>confirmContentDraftReadback(payload([{id:campaign,status:'published'}]),workspace,campaign),ContentDraftReadbackUnverified);
});
test('workspace mismatch, malformed or truncated response fails closed',()=>{
 assert.throws(()=>confirmContentDraftReadback(payload([{id:campaign,status:'draft'}]),otherWorkspace,campaign),ContentDraftReadbackUnverified);
 assert.throws(()=>confirmContentDraftReadback({data:{workspace:{id:workspace,name:'DEV workspace'},campaigns:[],contentItems:[]}},workspace,campaign),ContentDraftReadbackUnverified);
 assert.throws(()=>confirmContentDraftReadback(null,workspace,campaign),ContentDraftReadbackUnverified);
});
test('duplicate campaign ids fail strict validation before receipt confirmation',()=>{
 assert.throws(()=>confirmContentDraftReadback(payload([{id:campaign,status:'draft'},{id:campaign,status:'draft'}]),workspace,campaign),ContentDraftReadbackUnverified);
});
