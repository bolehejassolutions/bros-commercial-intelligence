/** Authenticated CONTENT DEV submission boundary.
 * This module does not connect to Neon, grant privileges, invoke providers,
 * charge credits or expose a route. A dedicated, separately approved
 * tenant-restricted writer must be injected before activation.
 */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
import {enqueueContentJob} from './neon-content-generation-job-lifecycle.ts';
import type {JobQuery} from './neon-content-generation-job-lifecycle.ts';

type Principal=Readonly<{userId:string;authenticated:true}>;
type Verify=(request:Request)=>Promise<Principal|null>;
type Authorize=(principal:Principal,workspaceId:string,campaignId:string)=>Promise<{tenantId:string}|null>;
type Writer=(principal:Principal,tenantId:string)=>Promise<JobQuery>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{12,128}$/;
function reply(status:number,body:object){return new Response(JSON.stringify(body),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Cookie, Authorization'
}});}
export function createContentJobSubmissionPost(verify:Verify,authorize:Authorize,writer:Writer){
 if(typeof verify!=='function'||typeof authorize!=='function'||typeof writer!=='function')
  throw new Error('Missing submission dependencies');
 return async(request:Request,workspaceId:string):Promise<Response>=>{
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(!UUID.test(workspaceId))return reply(404,{error:'not_found'});
  let url:URL;
  try{url=new URL(request.url);}catch{return reply(404,{error:'not_found'});}
  if(url.pathname!==`/api/content/dev/workspaces/${workspaceId}/generation-jobs`||url.search)
   return reply(404,{error:'not_found'});
  // Reject cross-site browser submissions before session verification or database access.
  // The route must not rely on JSON content type as its sole CSRF boundary.
  const origin=request.headers.get('origin');
  const fetchSite=request.headers.get('sec-fetch-site');
  if(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none')
   return reply(403,{error:'forbidden_origin'});
  if(origin&&origin!==url.origin)return reply(403,{error:'forbidden_origin'});
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))
   return reply(415,{error:'unsupported_media_type'});
  const size=Number(request.headers.get('content-length')??0);
  if(!Number.isFinite(size)||size>4096)return reply(413,{error:'payload_too_large'});
  let principal:Principal|null;
  try{principal=await verify(request);}catch{return reply(401,{error:'unauthorized'});}
  if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))
   return reply(401,{error:'unauthorized'});
  let body:unknown;
  try{const raw=await request.text();if(raw.length>4096)return reply(413,{error:'payload_too_large'});body=JSON.parse(raw);}
  catch{return reply(400,{error:'invalid_body'});}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'invalid_body'});
  const fields=body as Record<string,unknown>;
  if(Object.keys(fields).length!==2||!UUID.test(String(fields.campaignId??''))||
     !KEY.test(String(fields.idempotencyKey??'')))
   return reply(400,{error:'invalid_body'});
  try{
   const scope=await authorize(Object.freeze({userId:principal.userId,authenticated:true}),workspaceId,fields.campaignId as string);
   if(!scope||!UUID.test(scope.tenantId))return reply(404,{error:'not_found'});
   const db=await writer(principal,scope.tenantId);
   const job=await enqueueContentJob(db,{tenantId:scope.tenantId,campaignId:fields.campaignId as string,
    principalId:principal.userId,idempotencyKey:fields.idempotencyKey as string});
   if(!job||job.tenant_id!==scope.tenantId||job.campaign_id!==fields.campaignId||
      job.requested_by!==principal.userId)return reply(503,{error:'submission_unavailable'});
   return reply(202,{data:{id:job.id,campaignId:job.campaign_id,status:job.status,attempts:job.attempts}});
  }catch(e){
   if(e instanceof ContentReadDenied)return reply(404,{error:'not_found'});
   return reply(503,{error:'submission_unavailable'});
  }
 };
}
