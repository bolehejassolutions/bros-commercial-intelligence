import {NextRequest,NextResponse} from "next/server";
import {adminSession,validOrigin,forbidden,NO_STORE} from "@/lib/marketing-operator/server-auth";
import {generateOptionalGeminiDraft,safeDefaultDraft} from "@/lib/marketing-operator/campaign-plan";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 if(!validOrigin(req))return forbidden("Same-origin request required.");
 const auth=await adminSession();
 if(!auth)return forbidden();
 let angle="";
 try{const body=await req.json();angle=String(body.angle??"").trim().slice(0,260);}
 catch{return forbidden("Invalid creative brief",400);}
 try{
  const draft=await generateOptionalGeminiDraft(angle);
  return NextResponse.json({draft,aiConfigured:Boolean(process.env.GEMINI_API_KEY),requiresHumanReview:true},{headers:NO_STORE});
 }catch{
  return NextResponse.json({draft:safeDefaultDraft(),aiConfigured:Boolean(process.env.GEMINI_API_KEY),
   providerWarning:"AI provider unavailable; verified template supplied instead.",requiresHumanReview:true},{headers:NO_STORE});
 }
}
