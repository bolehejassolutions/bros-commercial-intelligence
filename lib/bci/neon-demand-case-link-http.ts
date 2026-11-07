/** Narrow signed DEV case action: no caller-supplied scope, receipt, SQL or body. */
import { isNeonPreviewEnabled, type NeonPreviewEnvironment } from "./neon-preview-handler.ts";
const receipt = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const headers = { "Cache-Control":"private, no-store, max-age=0", "Pragma":"no-cache",
  "Vary":"Authorization", "X-Content-Type-Options":"nosniff" };
const json = (v:unknown,s:number,extra?:Record<string,string>) =>
  Response.json(v,{status:s,headers:{...headers,...extra}});
const deny = (s:number) => json({error:"BCI private case action denied."},s);
type Result=Readonly<{caseId:string;receiptId:string;status:"inserted"|"replayed";
  reviewOnly:true;providerAttested:false}>;
type Deps=Readonly<{env:()=>NeonPreviewEnvironment;execute:(jwt:string)=>Promise<Result>}>;
export function createDemandCaseLinkHttpHandler(deps:Deps) {
 return async(request:Request):Promise<Response>=>{
  const env=deps.env();
  if(!isNeonPreviewEnabled(env)||env.BCI_NEON_DEV_CASE_LINK_WRITES!=="enabled")return deny(404);
  if(request.method!=="POST")return json({error:"Method not allowed."},405,{Allow:"POST"});
  let url:URL;try{url=new URL(request.url);}catch{return deny(400);}
  if(url.pathname!=="/api/internal/neon-demand-case"||url.search||url.hash||
     request.url.length>4096||request.headers.has("transfer-encoding")||
     Number(request.headers.get("content-length")||0)!==0||request.headers.has("content-type")||
     ["x-tenant-id","x-principal-id","x-user-id","x-role","x-admin","x-product","x-receipt-id"]
      .some(k=>request.headers.has(k)))return deny(400);
  if(request.headers.get("origin")!==url.origin||
     (request.headers.has("sec-fetch-site")&&request.headers.get("sec-fetch-site")!=="same-origin"))return deny(403);
  const auth=request.headers.get("authorization");
  if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return deny(401);
  try{
   const result=await deps.execute(auth.slice(7));
   if(!result||!["inserted","replayed"].includes(result.status)||result.reviewOnly!==true||
      result.providerAttested!==false||!/^[0-9a-f-]{36}$/.test(result.caseId)||
      result.receiptId!==receipt)return deny(403);
   return json({caseId:result.caseId,receiptId:receipt,status:result.status,
     reviewOnly:true,providerAttested:false},200);
  }catch{return deny(403);}
 };
}
