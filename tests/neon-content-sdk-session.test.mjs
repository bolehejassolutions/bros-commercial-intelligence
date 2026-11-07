import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentSdkSessionVerifier} from '../lib/content/neon-content-sdk-session.ts';
const user='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const session={user:{id:user},session:{userId:user,expiresAt:'2099-01-01T00:00:00Z'}};
const req=new Request('https://content.example.invalid/api/content/dev/workspaces/test',{
 headers:{'x-principal-id':'99999999-9999-4999-8999-999999999999'}
});
test('SDK session principal is authenticated server-side and ignores client-supplied principal headers',async()=>{
 for(const body of [session,{data:session}]){
  const verifier=createContentSdkSessionVerifier({getSession:async()=>body});
  assert.deepEqual(await verifier(req),{userId:user,authenticated:true});
 }
});
test('missing, mismatched, malformed or expired sessions fail closed',async()=>{
 for(const body of [
  null,{}, {error:{message:'denied'},data:null},
  {data:{user:{id:user},session:{userId:'other'}}},
  {user:{id:'not-a-uuid'},session:{userId:'not-a-uuid'}},
  {user:{id:user},session:null},
  {user:{id:user},session:{userId:user,expiresAt:'2001-01-01T00:00:00Z'}},
  {user:{id:user},session:{userId:user,expiresAt:'garbage'}},
 ]){
  assert.equal(await createContentSdkSessionVerifier({getSession:async()=>body})(req),null);
 }
});
test('SDK provider exceptions deny rather than bypassing membership and RLS',async()=>{
 const verifier=createContentSdkSessionVerifier({getSession:async()=>{throw Error('upstream offline');}});
 assert.equal(await verifier(req),null);
 assert.throws(()=>createContentSdkSessionVerifier(null));
});
