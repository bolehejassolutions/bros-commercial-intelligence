import test from "node:test";
import assert from "node:assert/strict";
import {readDemandMetaAccountInsights as read} from "../lib/demand/meta-insights-readonly.ts";
const req={accountId:"act_1997776120879476",apiVersion:"v26.0",since:"2026-11-01",until:"2026-11-07",observedAt:"2026-11-09T00:00:00Z"};
const token="synthetic-token-123456789012345";
const row={account_id:req.accountId.slice(4),date_start:req.since,date_stop:req.until,spend:"0.00",impressions:"0",clicks:"0"};
const transport=data=>async(url,init)=>{const u=new URL(url);assert.equal(u.origin,"https://graph.facebook.com");assert.equal(u.pathname,`/v26.0/${req.accountId}/insights`);assert.equal(u.searchParams.get("limit"),"1");assert.equal(init.method,"GET");assert.equal(init.cache,"no-store");assert.equal(init.redirect,"error");assert.equal(init.headers.Authorization,`Bearer ${token}`);assert.equal(url.includes(token),false);return {ok:true,json:async()=>data};};
const denied=/BROS_DEMAND_META_INSIGHTS_READ_FAILED/;
test("no rows are unknown, explicitly reported zero is zero",async()=>{const empty=await read(req,token,transport({data:[]}));assert.equal(empty.state,"NO_ROWS_NOT_ZERO");assert.equal(empty.spend,null);const zero=await read(req,token,transport({data:[row]}));assert.equal(zero.state,"PROVIDER_ROW");assert.equal(zero.spend,0);assert.equal(zero.impressions,0);assert.equal(zero.executionAllowed,false);assert.equal(Object.isFrozen(zero),true);});
test("invalid scope, dates and credential fail before transport",async()=>{let calls=0;const net=async()=>{calls++;throw Error("network");};for(const changes of [{accountId:"act_1/insights"},{apiVersion:"v26.0?x=1"},{since:"2026-02-30"},{until:"2027-01-01"},{until:"2026-10-01"},{observedAt:"2026-11-31T00:00:00Z"}])await assert.rejects(read({...req,...changes},token,net),denied);await assert.rejects(read(req,"bad\nheader",net),denied);assert.equal(calls,0);});
test("provider errors, wrong account, malformed rows and pagination fail closed",async()=>{for(const data of [{error:{message:token}},null,{data:[{...row,account_id:"wrong"}]},{data:[{...row,spend:"NaN"}]},{data:[{...row,clicks:"1.5"}]},{data:[row,row]},{data:[row],paging:{next:"https://evil.test"}},{data:"bad"}])await assert.rejects(read(req,token,transport(data)),denied);await assert.rejects(read(req,token,async()=>{throw Error(token);}),denied);await assert.rejects(read(req,token,async()=>({ok:false,json:async()=>({})})),denied);});

test("malformed paging and incomplete windows fail closed without leaking provider data",async()=>{
 const invalid=[
  null, false, 0, "", "cursor", [], ["next"], {next:""}, {previous:""},
  {next:null}, {previous:null}, {next:"",cursors:{}}, {cursors:null},
  {cursors:[]}, {cursors:{after:7}}, {cursors:{before:null}},
  {cursors:{unexpected:"x"}}, {unexpected:"x"}
 ];
 for(const paging of invalid){
  for(const data of [[],[row]]){
   await assert.rejects(read(req,token,transport({data,paging})),denied);
  }
 }
 const complete=await read(req,token,transport({data:[row],paging:{cursors:{before:"cursor-before",after:"cursor-after"}}}));
 assert.equal(complete.state,"PROVIDER_ROW");
 const empty=await read(req,token,transport({data:[],paging:{cursors:{}}}));
 assert.equal(empty.state,"NO_ROWS_NOT_ZERO");
 assert.equal(empty.spend,null);
});

test("Meta may report multiple clicks per impression; retain exact provider counts",async()=>{
 const observed=await read(req,token,transport({data:[{...row,impressions:"1",clicks:"3",spend:"0.20"}]}));
 assert.equal(observed.state,"PROVIDER_ROW");
 assert.equal(observed.impressions,1);
 assert.equal(observed.clicks,3);
 assert.equal(observed.spend,0.2);
 assert.equal(observed.executionAllowed,false);
});

test("direct Insights reader accepts exactly 31 inclusive days and rejects 32 before Meta transport",async()=>{
 const accepted={...req,since:"2026-10-01",until:"2026-10-31"};
 let acceptedCalls=0;
 const valid=await read(accepted,token,async()=>{acceptedCalls++;return {ok:true,json:async()=>({data:[]})};});
 assert.equal(valid.state,"NO_ROWS_NOT_ZERO");
 assert.equal(acceptedCalls,1);
 for(const invalid of [
  {...req,since:"2026-10-01",until:"2026-11-01"},
  {...req,since:"2026-01-01",until:"2026-02-01"}
 ]){
  let calls=0;
  await assert.rejects(read(invalid,token,async()=>{calls++;throw Error("unexpected provider access");}),denied);
  assert.equal(calls,0);
 }
});


test("MYR spend rejects fractional cents rather than silently rounding provider observations",async()=>{
 for(const spend of ["0.001","0.009","1.999","0.000","12.345","1e-3","-0.01"]){
  await assert.rejects(read(req,token,transport({data:[{...row,spend}]})),denied,spend);
 }
 for(const [spend,expected] of [["0",0],["0.00",0],["0.01",0.01],["1.2",1.2],["124.93",124.93]]){
  const observed=await read(req,token,transport({data:[{...row,spend}]}));
  assert.equal(observed.spend,expected,spend);
  assert.equal(observed.state,"PROVIDER_ROW");
 }
});

test("Meta impression and click counters reject fractional, exponential and unsafe integers",async()=>{
 for(const field of ["impressions","clicks"]){
  for(const value of ["0.0","1.00","1.5","1e2","-1","9007199254740992"]){
   await assert.rejects(read(req,token,transport({data:[{...row,[field]:value}]})),denied,field+"="+value);
  }
  for(const value of ["0","1","123456"]){
   const observed=await read(req,token,transport({data:[{...row,[field]:value}]}));
   assert.equal(observed[field],Number(value));
  }
 }
});

test("MYR spend parses exact cents and rejects unsafe or lossy numeric conversion",async()=>{
 for(const spend of ["90071992547409.92","900719925474099.00","999999999999999999.99"]){
  await assert.rejects(read(req,token,transport({data:[{...row,spend}]})),denied,spend);
 }
 for(const [spend,expected] of [["1000.01",1000.01],["123456.78",123456.78],["0.99",0.99]]){
  const observed=await read(req,token,transport({data:[{...row,spend}]}));
  assert.equal(observed.spend,expected,spend);
 }
});

test("collection timestamp is independently captured after provider response for both empty and populated results",async()=>{
 for(const data of [{data:[]},{data:[row]}]){
  const before=Date.now();
  const result=await read(req,token,transport(data));
  const after=Date.now();
  assert.match(result.collectedAt,/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/);
  assert.ok(Date.parse(result.collectedAt)>=before && Date.parse(result.collectedAt)<=after);
  assert.equal(result.observedAt,req.observedAt);
  assert.notEqual(result.collectedAt,req.observedAt);
  assert.equal(result.executionAllowed,false);
 }
});
