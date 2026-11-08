import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentDraftAcknowledgement,ContentDraftAcknowledgementInvalid} from '../lib/content/neon-content-draft-ack-response.ts';
const id='22222222-2222-4222-8222-222222222222';
test('fresh persisted draft receipt is accepted only with 201',()=>{
 assert.deepEqual(parseContentDraftAcknowledgement({data:{id,status:'draft'}},201),
  {id,status:'draft',replayed:false});
});
test('idempotent retry receipt is recognized',()=>{
 assert.deepEqual(parseContentDraftAcknowledgement({data:{id,status:'draft',replayed:true}},201),
  {id,status:'draft',replayed:true});
});
test('HTTP 200 alone or malformed 201 never certifies persistence',()=>{
 for(const status of [200,202,204,400,500])
  assert.throws(()=>parseContentDraftAcknowledgement({data:{id,status:'draft'}},status),ContentDraftAcknowledgementInvalid);
 for(const payload of [null,{},[],{data:null},{data:[]},{data:{}},
  {data:{id:'not-uuid',status:'draft'}},{data:{id,status:'published'}},
  {data:{id,status:'draft',replayed:false}},{data:{id,status:'draft',replayed:'true'}}])
  assert.throws(()=>parseContentDraftAcknowledgement(payload,201),ContentDraftAcknowledgementInvalid);
});
