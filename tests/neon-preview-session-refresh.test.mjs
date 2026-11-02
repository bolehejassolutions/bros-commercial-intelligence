import test from "node:test";
import assert from "node:assert/strict";
import {requestNeonPreviewSession, NeonPreviewSessionUnavailable}
  from "../lib/bci/neon-preview-client-token.ts";

const email = "operator@example.test";
const valid = () => ({session:{expiresAt:new Date(Date.now()+60000).toISOString()},
  user:{email,emailVerified:true}});

test("session revalidation requests provider state with credentials and bounded no-store fetch",async()=>{
  let options;
  assert.equal(await requestNeonPreviewSession({getSession:async value=>{
    options=value; return {data:valid(),error:null};
  }},email),true);
  assert.equal(options.fetchOptions.headers["X-Force-Fetch"],"true");
  assert.equal(options.fetchOptions.credentials,"include");
  assert.equal(options.fetchOptions.cache,"no-store");
  assert.ok(options.fetchOptions.signal instanceof AbortSignal);
});

test("signed-out, expired, unverified and wrong-operator sessions cannot authorize a submission",async()=>{
  const session=valid();
  for(const data of [null,{session:null,user:null},
    {...session,session:{expiresAt:new Date(Date.now()-1000).toISOString()}},
    {...session,user:{email,emailVerified:false}},
    {...session,user:{email:"other@example.test",emailVerified:true}}]) {
    assert.equal(await requestNeonPreviewSession({getSession:async()=>({data,error:null})},email),false);
  }
});

test("Date-valued SDK session expiry is supported",async()=>{
  const data=valid(); data.session.expiresAt=new Date(Date.now()+60000);
  assert.equal(await requestNeonPreviewSession({getSession:async()=>({data,error:null})},email),true);
});

test("malformed and failed provider reads fail closed without leaking provider data",async()=>{
  for(const data of [{},[],{session:{},user:{email,emailVerified:true}},
    {...valid(),session:{expiresAt:"not-a-date"}},{token:"sensitive-provider-data"}]) {
    await assert.rejects(requestNeonPreviewSession({getSession:async()=>({data,error:null})},email),
      error=>error instanceof NeonPreviewSessionUnavailable && !error.message.includes("sensitive-provider-data"));
  }
  for(const getSession of [
    async()=>({data:null,error:{message:"sensitive-provider-data"}}),
    async()=>{throw Error("sensitive-provider-data");},
  ]) await assert.rejects(requestNeonPreviewSession({getSession},email),
    error=>error instanceof NeonPreviewSessionUnavailable && !error.message.includes("sensitive-provider-data"));
});

