import {NextRequest,NextResponse} from "next/server";
import {adminSession,forbidden,NO_STORE,validOrigin} from "@/lib/marketing-operator/server-auth";
import {readWriteGate,validateApprovedPlan,makePausedObjects,metaCreatePaused,metaSetStatus,FIXED_META_ACCOUNT,requireExclusiveCampaignDelivery,type ApprovedPlan} from "@/lib/marketing-operator/meta-write";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
type Action="approve"|"stage"|"activate"|"pause";

export async function POST(req:NextRequest,{params}:Context){
 if(!validOrigin(req))return forbidden("Same-origin request required.");
 const auth=await adminSession();
 if(!auth)return forbidden();
 const {id}=await params;
 if(!/^[a-f0-9-]{36}$/i.test(id))return forbidden("Invalid plan ID.",400);
 let payload:{action?:Action;budget?:number;approvalPhrase?:string;activationConfirmation?:string};
 try{payload=await req.json();}catch{return forbidden("Invalid JSON request.",400);}
 if(!["approve","stage","activate","pause"].includes(payload?.action??""))return forbidden("Unknown action.",400);
 const {data:current,error:readError}=await auth.supabase.from("bci_campaign_plans").select("*").eq("id",id).single();
 if(readError||!current)return forbidden("Plan not found.",404);
 const plan=current as ApprovedPlan & {status:string};
 const action=payload.action as Action;

 if(action==="approve"){
  if(plan.status!=="DRAFT")return forbidden("Only unapproved drafts can be authorized.",409);
  const budget=Number(payload.budget);
  if(!Number.isFinite(budget)||budget<5||budget>10000)return forbidden("Invalid lifetime budget.",422);
  const phrase=String(payload.approvalPhrase??"");
  // DB RPC independently verifies exact phrase and budget, while guarding a single concurrent plan.
  const {data,error}=await auth.supabase.rpc("bci_approve_plan",{
   p_id:id,p_cap:budget,p_phrase:phrase,
  });
  if(error)return forbidden("Authorization rejected. Confirm the exact budget, phrase and other active plans.",409);
  return NextResponse.json({plan:data},{headers:NO_STORE});
 }

 // Even after a draft is approved, all Meta writes require independently stored
 // server-side credentials and a finite account-wide spending limit.
 let gate:ReturnType<typeof readWriteGate>;
 try{
   gate=readWriteGate();
   if(action==="pause"){
     if(plan.account_id!==FIXED_META_ACCOUNT||!plan.meta_campaign_id)
       throw new Error("Campaign identity cannot be verified for emergency pause.");
   } else validateApprovedPlan(plan,gate.portfolioCapMYR);
 }
 catch(e){return forbidden(e instanceof Error?e.message:"Write gateway blocked.",423);}
 if(action==="activate"){
  const expected="ACTIVATE RM"+Number(plan.budget_cap_myr).toFixed(2);
  if(payload.activationConfirmation!==expected)
    return forbidden("Activation requires entering "+expected+" exactly.",403);
  try{await requireExclusiveCampaignDelivery(plan.meta_campaign_id!,gate.token);}
  catch(e){return forbidden(e instanceof Error?e.message:"Ad-account preflight failed.",409);}
 }
 if(action==="stage"&&plan.status!=="APPROVED")return forbidden("Plan must be explicitly approved before staging.",409);
 if(action==="activate"&&plan.status!=="STAGED")return forbidden("Staging must finish before activation.",409);
 if(action==="pause"&&plan.status!=="ACTIVE")return forbidden("Only active campaigns can be paused.",409);

 // Current release supports one paid plan at a time and does not auto-increase spend.
 // Atomic claim prevents duplicated external POST operations under simultaneous requests.
 const operation=action.toUpperCase();
 const {data:claimed,error:claimError}=await auth.supabase.rpc("bci_claim_plan",{p_id:id,p_action:operation});
 if(claimError||!claimed)return forbidden("Plan state changed or authorization expired. No provider call was issued.",409);
 const frozen=claimed as ApprovedPlan;
 const record=async(step:"campaign"|"adset"|"creative"|"ad",metaId:string)=>{
  const {error}=await auth.supabase.rpc("bci_record_stage_id",{p_id:id,p_step:step,p_meta_id:metaId});
  if(error)throw new Error("Could not persist created Meta "+step+" ID. Do not retry automatically.");
 };
 const complete=async(state:"SUCCESS"|"FAILED",detail?:string)=>{
  const {error}=await auth.supabase.rpc("bci_complete_plan",{p_id:id,p_state:state,p_error:detail??null});
  if(error)throw new Error("Could not finalize operator state. Confirm provider state manually before retry.");
 };
 try{
  if(action==="stage"){
   const objects=makePausedObjects(frozen);
   const cid=await metaCreatePaused(FIXED_META_ACCOUNT,"campaigns",objects.campaign,gate.token);
   await record("campaign",cid);
   const aid=await metaCreatePaused(FIXED_META_ACCOUNT,"adsets",objects.adset(cid),gate.token);
   await record("adset",aid);
   const crid=await metaCreatePaused(FIXED_META_ACCOUNT,"adcreatives",objects.creative,gate.token);
   await record("creative",crid);
   const adid=await metaCreatePaused(FIXED_META_ACCOUNT,"ads",objects.ad(aid,crid),gate.token);
   await record("ad",adid);
   await complete("SUCCESS");
   return NextResponse.json({status:"STAGED",campaignId:cid,
    note:"All four objects created PAUSED. No ads are delivering."},{headers:NO_STORE});
  }
  if(action==="activate"){
   // Pre-activate children while parent campaign remains PAUSED. Parent is switched
   // last; any intermediate failure leaves campaign delivery disabled.
   await metaSetStatus(frozen.meta_ad_id!,"ACTIVE",gate.token);
   await metaSetStatus(frozen.meta_adset_id!,"ACTIVE",gate.token);
   await metaSetStatus(frozen.meta_campaign_id!,"ACTIVE",gate.token);
   try{await complete("SUCCESS");}
   catch{
    // If DB finalize fails after activating, immediately attempt emergency pause.
    await metaSetStatus(frozen.meta_campaign_id!,"PAUSED",gate.token);
    throw new Error("Unable to finalize activation; emergency pause attempted.");
   }
   return NextResponse.json({status:"ACTIVE",capMYR:Number(frozen.budget_cap_myr),
    note:"Activated with fixed Meta lifetime ad-set budget; never automatically increases."},{headers:NO_STORE});
  }
  if(action==="pause"){
   await metaSetStatus(frozen.meta_campaign_id!,"PAUSED",gate.token);
   await complete("SUCCESS");
   return NextResponse.json({status:"PAUSED",note:"Meta campaign paused."},{headers:NO_STORE});
  }
  throw new Error("Unexpected operator action.");
 }catch(e){
  const reason=e instanceof Error?e.message:"Provider execution failed.";
  try{await complete("FAILED",reason);}catch{
   // State becomes intervention-only after partial errors; no automatic retry.
  }
  return NextResponse.json({error:reason,
   note:"Manual account inspection required before retry. Never assume a partially staged ad is absent.",
   status:"NEEDS_RECONCILIATION"},{status:502,headers:NO_STORE});
 }
}
