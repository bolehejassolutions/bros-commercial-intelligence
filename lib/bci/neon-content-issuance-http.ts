import {isNeonPreviewEnabled,type NeonPreviewEnvironment} from "./neon-preview-handler.ts";
import type {ContentIssuanceInput,ContentIssuanceResult} from "./neon-content-issuance-service.ts";
const headers={"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",
  Vary:"Authorization","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status:number,extra:Record<string,string>={})=>
  Response.json(body,{status,headers:{...headers,...extra}});
const deny=(status:number)=>json({error:"CONTENT approval is unconfirmed or unavailable."},status);
type Dependencies=Readonly<{env:()=>NeonPreviewEnvironment;
  execute:(token:string,input:ContentIssuanceInput)=>Promise<ContentIssuanceResult>}>;
/** The transport accepts no tenant, reviewer, original media or callback from
 * the browser. Signing receipts does not bypass current JWT, source or RLS.
 */
export function createContentIssuanceHttpHandler(deps:Dependencies) {
  return async(request:Request):Promise<Response>=>{
    const env=deps.env();
    if(!isNeonPreviewEnabled(env)||env.BCI_NEON_DEV_CONTENT_APPROVALS!=="enabled")return deny(404);
    if(request.method!=="POST")return json({error:"Method not allowed."},405,{Allow:"POST"});
    let url:URL;try{url=new URL(request.url);}catch{return deny(400);}
    if(url.pathname!=="/api/internal/neon-content-approval"||url.search||url.hash||
       request.headers.has("transfer-encoding")||
       !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")||"")||
       ["x-tenant-id","x-bci-tenant-id","x-user-id","x-principal-id","x-role","x-admin","x-product"]
         .some(k=>request.headers.has(k)))return deny(400);
    if(request.headers.get("origin")!==url.origin||
       request.headers.has("sec-fetch-site")&&request.headers.get("sec-fetch-site")!=="same-origin")return deny(403);
    const auth=request.headers.get("authorization");
    if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return deny(401);
    const length=request.headers.get("content-length");
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)<1||Number(length)>131072))return deny(400);
    let input:ContentIssuanceInput;
    try {
      if(!request.body)return deny(400);
      const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try {for(;;){const item=await reader.read();if(item.done)break;
        size+=item.value.byteLength;if(size>131072)throw Error();chunks.push(item.value);}}
      finally{await reader.cancel();}
      if(size===0||length!==null&&size!==Number(length))return deny(400);
      const raw=new Uint8Array(size);let offset=0;
      for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}
      const p=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
      if(!p||typeof p!=="object"||Array.isArray(p)||Object.keys(p).length!==2||
         !Object.hasOwn(p,"proofEnvelopeId")||!Object.hasOwn(p,"receipt")||
         typeof p.proofEnvelopeId!=="string"||!/^content-instance-script-proof-[a-f0-9]{64}$/.test(p.proofEnvelopeId))return deny(400);
      input={proofEnvelopeId:p.proofEnvelopeId,receipt:p.receipt};
    }catch{return deny(400);}
    try{return json(await deps.execute(auth.slice(7),input),200);}catch{return deny(403);}
  };
}
