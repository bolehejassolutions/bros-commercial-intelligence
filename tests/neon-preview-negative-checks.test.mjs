import test from "node:test";
import assert from "node:assert/strict";
import { runNeonPreviewNegativeChecks } from "../lib/bci/neon-preview-negative-checks.ts";
const token = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0In0.c2ln";
test("seven bounded denial probes carry bearer only where needed and never persist it", async()=>{
 const calls=[];
 const mock=async (url,options)=>{
  calls.push({url,options});
  const status=options.method==="POST"?405:url.endsWith("?product=content")&&!options.headers.Authorization?401:400;
  return new Response(JSON.stringify({error:"denied"}),{status,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}});
 };
 const report=await runNeonPreviewNegativeChecks(token,mock);
 assert.equal(report.total,7);
 assert.equal(report.passed,7);
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.equal(calls[1].options.headers.Authorization,`Bearer ${token}`);
 assert.equal(calls.filter(c=>c.options.method==="POST").length,1);
 assert.equal(JSON.stringify(report).includes(token),false);
 assert.ok(calls.every(c=>c.options.redirect==="error"&&c.options.cache==="no-store"));
});
test("wrong status, missing no-store, or leaked evidence fails the probe",async()=>{
 for(const variant of ["status","cache","leak"]){
  const mock=async()=>new Response(variant==="leak"?JSON.stringify({evidence:[{}]}):"{}",{
   status:variant==="status"?200:400,
   headers:{"Cache-Control":variant==="cache"?"public":"no-store","Vary":"Authorization"},
  });
  const report=await runNeonPreviewNegativeChecks(token,mock);
  assert.equal(report.passed,0);
 }
});
test("network failure is recorded as failure, without returning secrets",async()=>{
 const report=await runNeonPreviewNegativeChecks(token,async()=>{throw new Error("secret-connection");});
 assert.equal(report.passed,0);
 assert.equal(JSON.stringify(report).includes("secret"),false);
});
test("rejects malformed tokens without issuing any request",async()=>{
 let called=0;
 await assert.rejects(runNeonPreviewNegativeChecks("bad",async()=>{called++;}),/Invalid preview token/);
 assert.equal(called,0);
});
