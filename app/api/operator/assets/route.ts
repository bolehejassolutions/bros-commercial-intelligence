import {NextRequest,NextResponse} from "next/server";
import {adminSession,validOrigin,forbidden,NO_STORE} from "@/lib/marketing-operator/server-auth";
import {FIXED_META_ACCOUNT,readVerifiedWriteGate} from "@/lib/marketing-operator/meta-write";
import {metaProviderRequest,metaProviderJson,safeMetaProviderCode} from "@/lib/marketing-operator/meta-provider";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 if(!validOrigin(req))return forbidden("Same-origin request required.");
 const auth=await adminSession();
 if(!auth)return forbidden();
 let token:string;
 try{token=(await readVerifiedWriteGate()).token;}
 catch(e){return forbidden(e instanceof Error?e.message:"Media upload locked.",423);}
 let file:FormDataEntryValue|null;
 try{
  const input=await req.formData();
  if(input.get("approved")!=="true")throw Error("Explicit brand asset confirmation is required.");
  file=input.get("image");
 }catch{return forbidden("Invalid image upload request.",400);}
 if(!(file instanceof File)||!["image/png","image/jpeg"].includes(file.type)||file.size<512||file.size>8*1024*1024)
  return forbidden("Provide an approved PNG/JPEG image between 512 bytes and 8MB.",422);
 const bytes=new Uint8Array(await file.arrayBuffer());
 const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
 const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if((file.type==="image/png"&&!png)||(file.type==="image/jpeg"&&!jpg))
  return forbidden("Image format and file signature do not match.",422);
 const outbound=new FormData();
 outbound.set("filename",new Blob([bytes],{type:file.type}),file.type==="image/png"?"bros-approved.png":"bros-approved.jpg");
 try{
  const response=await metaProviderRequest("https://graph.facebook.com/v24.0/"+FIXED_META_ACCOUNT+"/adimages",{
   method:"POST",headers:{Authorization:"Bearer "+token},
   body:outbound,cache:"no-store",signal:AbortSignal.timeout(20000),
  });
  const result=await metaProviderJson(response) as {images?:Record<string,{hash?:string}>;error?:{code?:number}};
  if(!response.ok||result.error)return forbidden("Meta rejected the image upload (code "+safeMetaProviderCode(result.error?.code,response.status)+").",502);
  const hash=Object.values(result.images??{})[0]?.hash;
  if(!hash||!/^[a-f0-9]{32}$/i.test(hash))return forbidden("Meta did not return a verified image hash.",502);
  return NextResponse.json({imageHash:hash,source:"Meta Ads image library",accountId:FIXED_META_ACCOUNT},{headers:NO_STORE});
 }catch{
  return forbidden("Meta image upload failed. Inspect provider before retrying.",502);
 }
}
