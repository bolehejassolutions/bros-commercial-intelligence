/**
 * Narrow, independently gated Meta Marketing API write adapter.
 * No credential or environment switch has been configured in deployment.
 * No arbitrary endpoint, objective, account, budget mutation or URL input.
 * All initial objects are created PAUSED.
 */
export const FIXED_META_ACCOUNT="act_1997776120879476";
export const FIXED_DESTINATION="https://bros.bolehejas.com/";
const GRAPH="https://graph.facebook.com/v24.0";
export type ApprovedPlan={
 id:string; account_id:string;name:string;objective:"TRAFFIC"|"SALES";
 primary_text:string;headline:string;description:string;page_id:string;image_hash:string;
 pixel_id:string|null;duration_days:number;budget_cap_myr:number|string;
 authorization_expires_at:string;meta_campaign_id:string|null;meta_adset_id:string|null;
 meta_creative_id:string|null;meta_ad_id:string|null;
};

export function readWriteGate(environment:NodeJS.ProcessEnv=process.env) {
 if(environment.META_OPERATOR_WRITE_ENABLED!=="approved-v1")
  throw new Error("Meta write gateway is locked; explicit operator activation is required.");
 const token=environment.META_ADS_MANAGEMENT_TOKEN;
 if(!token||token.length<24)throw new Error("Server-only Meta write credential has not been configured.");
 const max=Number(environment.META_OPERATOR_PORTFOLIO_CAP_MYR);
 if(!Number.isFinite(max)||max<5||max>10000)
   throw new Error("No finite portfolio spending cap has been authorized in the deployment.");
 return {token,portfolioCapMYR:max};
}

export function validateApprovedPlan(plan:ApprovedPlan,portfolioCapMYR:number,at=Date.now()) {
 const cap=Number(plan.budget_cap_myr);
 if(plan.account_id!==FIXED_META_ACCOUNT)throw new Error("Unapproved ad account.");
 if(plan.objective!=="TRAFFIC"&&plan.objective!=="SALES")throw new Error("Invalid objective.");
 if(!Number.isFinite(cap)||cap<5||cap>portfolioCapMYR||Math.abs(Math.round(cap*100)-cap*100)>1e-7)
   throw new Error("Plan lifetime budget exceeds fixed portfolio authority.");
 if(!Number.isInteger(plan.duration_days)||plan.duration_days<1||plan.duration_days>30)
   throw new Error("Invalid flight duration.");
 if(!/^BROS\s*SELL/i.test(plan.name)||!/^[0-9]{6,}$/.test(plan.page_id)||!/^[a-f0-9]{32}$/i.test(plan.image_hash))
   throw new Error("Unverified business page, image hash or campaign name.");
 if(plan.objective==="SALES"&&!/^[0-9]{6,}$/.test(plan.pixel_id??""))
   throw new Error("Sales objective requires a verified Meta pixel ID.");
 if(!Number.isFinite(Date.parse(plan.authorization_expires_at))||Date.parse(plan.authorization_expires_at)<=at)
   throw new Error("Plan authorization expired.");
 if(!plan.primary_text||!plan.headline)throw new Error("No verified creative copy.");
 return {capMYR:cap,budgetMinorUnits:Math.round(cap*100)};
}

type Operation="campaigns"|"adsets"|"adcreatives"|"ads";
const allow:readonly Operation[]=["campaigns","adsets","adcreatives","ads"];
export async function metaCreatePaused(
 accountId:string,operation:Operation,body:Record<string,unknown>,token:string,transport:typeof fetch=fetch
):Promise<string> {
 if(accountId!==FIXED_META_ACCOUNT||!allow.includes(operation))throw new Error("Unapproved Meta destination");
 if(!token)throw new Error("No server credential");
 const form=new URLSearchParams();
 for(const [key,value] of Object.entries(body)){
  if(value===undefined||value===null)continue;
  form.set(key,typeof value==="string"?value:JSON.stringify(value));
 }
 const response=await transport(GRAPH+"/"+accountId+"/"+operation,{
  method:"POST",headers:{"Authorization":"Bearer "+token,
   "Content-Type":"application/x-www-form-urlencoded"},
  body:form.toString(),cache:"no-store",signal:AbortSignal.timeout(16000),
 });
 const result=await response.json() as {id?:string;error?:{message?:string;code?:number}};
 if(!response.ok||result.error)throw new Error("Meta "+operation+" failed (code "+(result.error?.code??response.status)+"). Review account status and permissions.");
 if(!/^[0-9]{6,}$/.test(result.id??""))throw new Error("Meta response missing object ID; do not retry automatically.");
 return result.id!;
}
export async function metaSetStatus(
 objectId:string,status:"ACTIVE"|"PAUSED",token:string,transport:typeof fetch=fetch
) {
 if(!/^[0-9]{6,}$/.test(objectId)||!token)throw new Error("Invalid Meta object or credential.");
 const response=await transport(GRAPH+"/"+objectId,{
  method:"POST",headers:{"Authorization":"Bearer "+token,
   "Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({status}).toString(),cache:"no-store",signal:AbortSignal.timeout(16000),
 });
 const result=await response.json() as {success?:boolean,error?:{code?:number}};
 if(!response.ok||result.success!==true)throw new Error("Meta status update failed (code "+(result.error?.code??response.status)+"). Confirm provider state before any retry.");
}
export function makePausedObjects(plan:ApprovedPlan,at=Date.now()){
 const validated=validateApprovedPlan(plan,Number(plan.budget_cap_myr),at);
 // Start cannot precede explicit activation; Meta may reject an expired start time
 // if the staging process takes too long. These objects remain PAUSED.
 const start=new Date(at+10*60000).toISOString();
 const end=new Date(at+(plan.duration_days*86400000)+10*60000).toISOString();
 return {
  campaign:{
    name:plan.name,objective:plan.objective==="SALES"?"OUTCOME_SALES":"OUTCOME_TRAFFIC",
    special_ad_categories:[],status:"PAUSED",buying_type:"AUCTION"},
  adset:(campaignId:string)=>({
    name:plan.name+" | MY | Lifetime Cap",
    campaign_id:campaignId,
    lifetime_budget:validated.budgetMinorUnits,
    start_time:start,end_time:end,
    billing_event:"IMPRESSIONS",
    optimization_goal:plan.objective==="SALES"?"OFFSITE_CONVERSIONS":"LINK_CLICKS",
    destination_type:"WEBSITE",
    ...(plan.objective==="SALES"?{promoted_object:{pixel_id:plan.pixel_id,custom_event_type:"PURCHASE"}}:{}),
    targeting:{geo_locations:{countries:["MY"]},age_min:18,age_max:65},
    status:"PAUSED",
  }),
  creative:{
    name:plan.name+" | Creative v1",
    object_story_spec:{
      page_id:plan.page_id,
      link_data:{
        link:FIXED_DESTINATION,image_hash:plan.image_hash,
        message:plan.primary_text,name:plan.headline,description:plan.description,
        call_to_action:{type:"LEARN_MORE",value:{link:FIXED_DESTINATION}},
      },
    },
  },
  ad:(adsetId:string,creativeId:string)=>({
    name:plan.name+" | Ad v1",
    adset_id:adsetId,creative:{creative_id:creativeId},status:"PAUSED",
  }),
 };
}
