/** Existing shared BCI DEV reservation adapter exposed through its own
 * authenticated boundary. This route cannot issue approval or publish.
 */
import {isNeonPreviewEnabled,type NeonPreviewEnvironment} from "./neon-preview-handler.ts";
type Input=Readonly<{dispatchIntentId:string;approvalId:string;bindingSha256:string}>;
type Result=Readonly<{status:"acquired"|"already_reserved";reservationId:string|null}>;
type Deps=Readonly<{env:()=>NeonPreviewEnvironment;
  execute:(jwt:string,input:Input)=>Promise<Result>}>;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",
  Vary:"Authorization","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status:number,extra?:Record<string,string>)=>
  Response.json(body,{status,headers:{...headers,...extra}});
const denied=(status:number)=>json({error:"BCI private CONTENT reservation unconfirmed or denied."},status);
const exact=(x:unknown,fields:string[]):x is Record<string,unknown>=>
  !!x&&typeof x==="object"&&!Array.isArray(x)&&
  Reflect.ownKeys(x).length===fields.length&&fields.every(k=>{
    const d=Object.getOwnPropertyDescriptor(x,k);
    return d?.enumerable===true&&Object.hasOwn(d,"value");
  });

export function createContentReservationHttpHandler(deps:Deps){
  return async(request:Request):Promise<Response>=>{
    const env=deps.env();
    if(!isNeonPreviewEnabled(env)||env.BCI_NEON_DEV_CONTENT_RESERVATIONS!=="enabled")return denied(404);
    if(request.method!=="POST")return json({error:"Method not allowed."},405,{Allow:"POST"});
    let url:URL;try{url=new URL(request.url);}catch{return denied(400);}
    if(request.url.length>2048||url.pathname!=="/api/internal/neon-content-reservation"||
      url.search!==""||url.hash!==""||request.headers.has("transfer-encoding")||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")||"")||
      ["x-tenant-id","x-bci-tenant-id","x-user-id","x-principal-id","x-role","x-admin","x-product"]
        .some(k=>request.headers.has(k)))return denied(400);
    if(request.headers.get("origin")!==url.origin||
      (request.headers.has("sec-fetch-site")&&request.headers.get("sec-fetch-site")!=="same-origin"))return denied(403);
    const auth=request.headers.get("authorization");
    if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return denied(401);
    const length=request.headers.get("content-length");
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)<1||Number(length)>2048))return denied(400);
    let input:Input;
    try{
      if(request.body===null)return denied(400);
      const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      try{
        for(;;){const item=await reader.read();if(item.done)break;
          size+=item.value.byteLength;if(size>2048)throw Error();chunks.push(item.value);}
      }finally{await reader.cancel();}
      if(size===0||(length!==null&&size!==Number(length)))return denied(400);
      const bytes=new Uint8Array(size);let at=0;
      for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
      const p:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      if(!exact(p,["dispatchIntentId","approvalId","bindingSha256"])||
        typeof p.dispatchIntentId!=="string"||!id.test(p.dispatchIntentId)||
        typeof p.approvalId!=="string"||!id.test(p.approvalId)||
        typeof p.bindingSha256!=="string"||!/^[0-9a-f]{64}$/.test(p.bindingSha256))return denied(400);
      input=Object.freeze({dispatchIntentId:p.dispatchIntentId,approvalId:p.approvalId,bindingSha256:p.bindingSha256});
    }catch{return denied(400);}
    try{
      const result=await deps.execute(auth.slice(7),input);
      if(!exact(result,["status","reservationId"]))return denied(403);
      if(result.status==="acquired"&&typeof result.reservationId==="string"&&uuid.test(result.reservationId))
        return json({status:"reserved",reservationId:result.reservationId,
          postCommitReadback:true,providerSent:false,executionAllowed:false},200);
      if(result.status==="already_reserved"&&result.reservationId===null)
        return json({status:"reconciliation_required",reservationId:null,
          postCommitReadback:true,providerSent:false,executionAllowed:false},200);
      return denied(403);
    }catch{return denied(403);}
  };
}
