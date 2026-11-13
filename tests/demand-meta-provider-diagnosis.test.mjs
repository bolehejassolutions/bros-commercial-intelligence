import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseDemandMetaError} from '../lib/demand/meta-provider-diagnosis.mjs';
test('maps known permission, auth, rate-limit and invalid request codes without implying readiness',()=>{
 for(const [code,state,retryable,owner] of [[190,'TOKEN_INVALID_OR_EXPIRED',false,true],[10,'PERMISSION_DENIED',false,true],[200,'PERMISSION_DENIED',false,true],[4,'RATE_LIMITED',true,false],[17,'RATE_LIMITED',true,false],[32,'RATE_LIMITED',true,false],[613,'RATE_LIMITED',true,false],[100,'INVALID_REQUEST',false,false]]){
  const r=diagnoseDemandMetaError({error:{code,message:'private token',error_user_msg:'private customer data'}});
  assert.deepEqual(r,{state,retryable,requiresOwnerAction:owner,providerAuthenticationVerified:false,metaWriteAllowed:false});
  assert.equal(JSON.stringify(r).includes('private'),false);
 }
});
test('unknown and malformed provider errors fail closed without unsafe retry',()=>{
 for(const v of [null,{},[],{error:null},{error:{code:'190'}},{error:{code:-1}},{error:{code:9999}},{error:{code:NaN}}]){
  const r=diagnoseDemandMetaError(v);
  assert.equal(r.state,'PROVIDER_UNVERIFIED');assert.equal(r.retryable,false);assert.equal(r.metaWriteAllowed,false);
 }
});
test('hostile proxy cannot leak messages or authorize writes',()=>{
 const r=diagnoseDemandMetaError(new Proxy({}, {get(){throw Error('SECRET')}}));
 assert.equal(r.state,'PROVIDER_UNVERIFIED');assert.equal(JSON.stringify(r).includes('SECRET'),false);
});
