import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentNeonSessionVerifier} from '../lib/content/neon-content-session-verifier.ts';
const BASE='https://ep-example.neonauth.c-4.ap-southeast-1.aws.neon.tech/db/auth';
const ID='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const req=(cookie='session=abc')=>new Request('https://content.example.invalid/api',{headers:cookie?{cookie}:{}});
const session={user:{id:ID},session:{userId:ID}};
test('verified Neon Auth user/session identity is returned, no client principal forwarded',async()=>{
 let called=0;
 const verify=createContentNeonSessionVerifier(BASE,async(url,init)=>{
  called++;assert.equal(url,BASE+'/get-session');assert.equal(init.headers.cookie,'session=abc');
  assert.equal(init.headers.authorization,undefined);
  assert.equal(init.redirect,'error');return Response.json(session);
 });
 assert.deepEqual(await verify(req()),{userId:ID,authenticated:true});assert.equal(called,1);
});
test('missing cookie denies without network request',async()=>{
 const verify=createContentNeonSessionVerifier(BASE,async()=>{throw Error('must not call');});
 assert.equal(await verify(req('')),null);
});
test('mismatched session identity and malformed data fail closed',async()=>{
 for(const data of [null,{}, {user:{id:ID}}, {user:{id:ID},session:{userId:'other'}},{user:{id:'invalid'},session:{userId:'invalid'}}]){
  const verify=createContentNeonSessionVerifier(BASE,async()=>Response.json(data));
  assert.equal(await verify(req()),null);
 }
});
test('network failure, non-200 response and malformed JSON fail closed',async()=>{
 for(const fetcher of [
  async()=>{throw Error('offline');},
  async()=>new Response('denied',{status:401}),
  async()=>new Response('not-json',{status:200})
 ]){
  const verify=createContentNeonSessionVerifier(BASE,fetcher);
  assert.equal(await verify(req()),null);
 }
});
test('reject non-Neon and insecure Auth URLs',()=>{
 for(const url of ['http://example.neon.tech/db/auth','https://evil.example/db/auth','https://example.neon.tech/db/not-auth','https://user:pass@example.neon.tech/db/auth'])
  assert.throws(()=>createContentNeonSessionVerifier(url));
});
