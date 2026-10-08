import test from "node:test";
import assert from "node:assert/strict";
import {shouldPauseAtCap,malaysiaDate,metaCampaignSpend,pauseOnlyWhenAtCap} from "../lib/marketing-operator/monitor.ts";
import {FIXED_META_ACCOUNT} from "../lib/marketing-operator/meta-write.ts";
test("budget monitor pauses only with concrete measured spend near lifetime cap",()=>{
 assert.equal(shouldPauseAtCap(94.99,100),false);
 assert.equal(shouldPauseAtCap(95,100),true);
 assert.equal(shouldPauseAtCap(110,100),true);
 for(const value of [null,undefined,"",NaN,Infinity,-1])assert.equal(shouldPauseAtCap(value,100),false);
 assert.equal(shouldPauseAtCap(95,null),false);
});
test("Malaysia reporting day avoids UTC day boundary confusion",()=>{
 assert.equal(malaysiaDate(new Date("2026-10-08T20:15:00Z")),"2026-10-09");
 assert.equal(malaysiaDate(new Date("2026-10-08T01:30:00Z")),"2026-10-08");
});
test("campaign monitoring reads only named Meta campaign, never budgets",async()=>{
 const calls=[];
 const transport=async(url,options)=>{
  calls.push({url,options});
  return new Response(JSON.stringify({data:[{spend:"96.11"}]}),{status:200});
 };
 const spend=await metaCampaignSpend("123456789011","token","2026-10-01","2026-10-09",transport);
 assert.equal(spend,96.11);
 assert.equal(calls.length,1);
 assert.equal(calls[0].options.method,"GET");
 assert.ok(calls[0].url.includes("/123456789011/insights"));
 assert.ok(!calls[0].url.includes("token"));
});
test("locked monitor refuses any write without independent server gate",async()=>{
 const env={META_OPERATOR_WRITE_ENABLED:"",META_ADS_MANAGEMENT_TOKEN:"test-token-test-token-987654321",
  META_OPERATOR_PORTFOLIO_CAP_MYR:"100"};
 await assert.rejects(()=>pauseOnlyWhenAtCap({account_id:FIXED_META_ACCOUNT,
 meta_campaign_id:"123456789011",budget_cap_myr:100,authorized_at:"2026-10-08T10:00:00Z"},
 undefined,env),/locked/);
});
test("unapproved ad account never reaches Meta monitor",async()=>{
 await assert.rejects(()=>pauseOnlyWhenAtCap({
 account_id:"act_11111111",meta_campaign_id:"123456789011",budget_cap_myr:100,
 authorized_at:"2026-10-08T10:00:00Z",
 }),/Unapproved/);
});
