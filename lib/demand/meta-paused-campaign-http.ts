import type {PilotScope} from './meta-pilot-ledger.ts';
import {PilotReconciliationRequired} from './meta-pilot-ledger.ts';
import type {createPausedCampaignService} from './meta-paused-campaign-service.ts';
type Deps={enabled:()=>boolean;authorize:(jwt:string)=>Promise<PilotScope>;
  service:(scope:PilotScope,reauthorize:()=>Promise<void>)=>ReturnType<typeof createPausedCampaignService>};
const headers={'Cache-Control':'private, no-store, max-age=0',Pragma:'no-cache',Vary:'Authorization','X-Content-Type-Options':'nosniff'};
const json=(body:unknown,status:number)=>Response.json(body,{status,headers});
async function body(request:Request){
  const reader=request.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>32768)throw Error();chunks.push(r.value);}}
  finally{await reader.cancel();}
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==size))throw Error();
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p as Record<string,unknown>;
}
export function createPausedCampaignHttpHandler(deps:Deps){
  return async(request:Request)=>{
    if(!deps.enabled())return json({error:'Private campaign creator unavailable.'},404);
    if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
    const url=new URL(request.url);
    if(url.pathname!=='/api/internal/demand-meta-campaigns'||url.search||url.hash||
       ['x-tenant-id','x-user-id','x-role','x-admin','x-product','x-bci-tenant-id','x-meta-token'].some(k=>request.headers.has(k))||
       request.headers.has('transfer-encoding')||Number(request.headers.get('content-length')??0)>32768||
       request.method==='GET'&&request.body!==null)return json({error:'Campaign request rejected.'},400);
    if(request.method==='POST'&&(request.headers.get('origin')!==url.origin||
       !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||'')||
       request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'))return json({error:'Campaign request rejected.'},403);
    const auth=request.headers.get('authorization');
    if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return json({error:'Sign in to prepare a campaign.'},401);
    let scope:PilotScope;try{scope=await deps.authorize(auth.slice(7));}catch{return json({error:'Operator access denied.'},403);}
    const reauthorize=async()=>{const current=await deps.authorize(auth.slice(7));
      if(current.tenantId!==scope.tenantId||current.principalId!==scope.principalId)throw Error();};
    const service=deps.service(scope,reauthorize);
    try{
      if(request.method==='GET')return json(await service.readiness(),200);
      let p:Record<string,unknown>;try{p=await body(request);}catch{return json({error:'Invalid campaign form.'},400);}
      if(p.action==='verify_ledger'&&Object.keys(p).length===1)return json(await service.verifyLedger(scope),200);
      if(p.action==='preview'&&Object.keys(p).length===2&&Object.hasOwn(p,'draft'))return json(await service.preview(scope,p.draft),200);
      if(p.action==='reconcile'&&Object.keys(p).length===4&&Object.hasOwn(p,'draft')&&
         typeof p.planSha256==='string'&&/^[a-f0-9]{64}$/.test(p.planSha256)&&p.authorization==='RECONCILE_PAUSED_ONLY')
        return json(await service.reconcile(scope,p.draft,p.planSha256,p.authorization),200);
      if(p.action==='create_paused'&&Object.keys(p).length===4&&Object.hasOwn(p,'draft')&&
         typeof p.planSha256==='string'&&/^[a-f0-9]{64}$/.test(p.planSha256)&&p.authorization==='CREATE_PAUSED_ONLY')
        return json(await service.stage(scope,p.draft,p.planSha256,p.authorization),200);
      return json({error:'Explicit paused-only review and exact unchanged plan are required.'},400);
    }catch(error){return json({error:'Campaign creation is blocked or unconfirmed. Review setup and operation records.',
      reconcileRequired:error instanceof PilotReconciliationRequired},409);}
  };
}
