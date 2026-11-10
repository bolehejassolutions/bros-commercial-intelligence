import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentDraftAcknowledgement,ContentDraftAcknowledgementInvalid} from '../lib/content/neon-content-draft-ack-response.ts';

const id='33333333-3333-4333-8333-333333333333';
const payload=replayed=>({data:{id,status:'draft',...(replayed===undefined?{}:{replayed})}});

test('new draft acknowledgement accepts explicit false replay flag',()=>{
 assert.deepEqual(parseContentDraftAcknowledgement(payload(false),201),{id,status:'draft',replayed:false});
});
test('replayed draft acknowledgement accepts true replay flag',()=>{
 assert.deepEqual(parseContentDraftAcknowledgement(payload(true),201),{id,status:'draft',replayed:true});
});
test('legacy acknowledgement without replay flag remains safe and non-replayed',()=>{
 assert.deepEqual(parseContentDraftAcknowledgement(payload(undefined),201),{id,status:'draft',replayed:false});
});
test('malformed replay flags and unsuccessful HTTP responses fail closed',()=>{
 for(const flag of [null,0,1,'false',{},[]]){
  assert.throws(()=>parseContentDraftAcknowledgement(payload(flag),201),ContentDraftAcknowledgementInvalid);
 }
 assert.throws(()=>parseContentDraftAcknowledgement(payload(false),503),ContentDraftAcknowledgementInvalid);
});
