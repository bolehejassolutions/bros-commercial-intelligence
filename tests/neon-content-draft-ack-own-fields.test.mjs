import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentDraftAcknowledgement,ContentDraftAcknowledgementInvalid} from '../lib/content/neon-content-draft-ack-response.ts';
const id='22222222-2222-4222-8222-222222222222';
const reject=(payload)=>assert.throws(()=>parseContentDraftAcknowledgement(payload,201),ContentDraftAcknowledgementInvalid);
test('own plain persisted acknowledgement is accepted',()=>{
 assert.deepEqual(parseContentDraftAcknowledgement({data:{id,status:'draft',replayed:false}},201),{id,status:'draft',replayed:false});
});
test('inherited data cannot certify persistence',()=>{
 reject(Object.create({data:{id,status:'draft'}}));
});
test('inherited id or status cannot certify persistence',()=>{
 reject({data:Object.assign(Object.create({id}),{status:'draft'})});
 reject({data:Object.assign(Object.create({status:'draft'}),{id})});
});
test('accessor data and fields never execute during acknowledgement parsing',()=>{
 let invoked=0;
 const accessor=()=>{invoked++;throw Error('should not execute');};
 const payload={};Object.defineProperty(payload,'data',{get:accessor});
 reject(payload);
 for(const field of ['id','status','replayed']){
  const data={id,status:'draft',replayed:false};
  Object.defineProperty(data,field,{get:accessor});
  reject({data});
 }
 assert.equal(invoked,0);
});
test('inherited replay flag does not change fresh receipt',()=>{
 const data=Object.assign(Object.create({replayed:true}),{id,status:'draft'});
 assert.deepEqual(parseContentDraftAcknowledgement({data},201),{id,status:'draft',replayed:false});
});
