import {NextRequest,NextResponse} from "next/server";
import {adminSession,forbidden,validOrigin,NO_STORE} from "@/lib/marketing-operator/server-auth";
import {validateCreative} from "@/lib/marketing-operator/campaign-plan";

export const dynamic="force-dynamic";
export async function GET(){
 const auth=await adminSession();
 if(!auth)return forbidden();
 const {data,error}=await auth.supabase.from("bci_campaign_plans")
 .select("id,created_at,name,objective,headline,primary_text,description,page_id,image_hash,pixel_id,duration_days,budget_cap_myr,status,authorized_at,authorization_expires_at,meta_campaign_id,meta_adset_id,meta_creative_id,meta_ad_id,last_error")
 .order("created_at",{ascending:false}).limit(30);
 if(error)return forbidden("Operator campaign schema unavailable.",503);
 return NextResponse.json({plans:data??[]},{headers:NO_STORE});
}
export async function POST(req:NextRequest){
 if(!validOrigin(req))return forbidden("Same-origin request required.");
 const auth=await adminSession();
 if(!auth)return forbidden();
 let input:Record<string,unknown>;
 try{input=await req.json();if(!input||typeof input!=="object"||Array.isArray(input))throw Error();}
 catch{return forbidden("Invalid plan payload.",400);}
 try{
  const name=String(input.name??"").trim();
  const objective=String(input.objective??"");
  const page_id=String(input.pageId??"").trim();
  const image_hash=String(input.imageHash??"").trim();
  const pixel_id=String(input.pixelId??"").trim();
  const duration_days=Number(input.durationDays);
  const assetsConfirmed=input.assetsConfirmed===true;
  if(!/^BROS\s*SELL/i.test(name)||name.length>140||name.length<5)throw Error("Campaign name must start with BROS SELL.");
  if(objective!=="TRAFFIC"&&objective!=="SALES")throw Error("Only TRAFFIC or SALES objective supported.");
  if(!/^[0-9]{6,}$/.test(page_id))throw Error("Provide an authorized Facebook Page ID.");
  if(!/^[a-f0-9]{32}$/i.test(image_hash))throw Error("Provide an approved image hash from the authorized Meta account.");
  if(objective==="SALES"&&!/^[0-9]{6,}$/.test(pixel_id))throw Error("SALES requires a verified Purchase pixel.");
  if(!Number.isInteger(duration_days)||duration_days<1||duration_days>30)throw Error("Campaign duration must be 1–30 days.");
  if(!assetsConfirmed)throw Error("Confirm the image, page and copy are approved BROS assets and factual.");
  const creative=validateCreative({headline:input.headline,primaryText:input.primaryText,description:input.description});
  const {data,error}=await auth.supabase.from("bci_campaign_plans").insert({
   created_by:auth.user.id,name,objective,
   headline:creative.headline,primary_text:creative.primaryText,description:creative.description,
   page_id,image_hash,pixel_id:objective==="SALES"?pixel_id:null,duration_days,
  }).select("id,name,status").single();
  if(error)throw Error("Database rejected plan. Check verified membership and fields.");
  return NextResponse.json({plan:data},{status:201,headers:NO_STORE});
 }catch(error){
  return forbidden(error instanceof Error?error.message:"Draft validation failed.",422);
 }
}
