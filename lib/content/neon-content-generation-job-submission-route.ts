/** Authenticated CONTENT DEV submission. No provider, credits or scheduler. */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
import {submitRestrictedContentJob} from './neon-content-generation-job-atomic-submission.ts';
type Principal=Readonly<{userId:string;authenticated:true}>;
type Verify=(request:Request)=>Promise<Principal|null>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{12,128}$/;
const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff'}});
export function createContentJobSubmissionPost(verify:Verify){
 return async(request:Request,workspaceId:string):Promise<Response>=>{
  if(request.method!=='POST')return reply(405,'method_not_allowed');
  if(!UUID.test(workspaceId))return reply(404,'not_found');
  let url:URL;
  try{url=new URL(request.url);}catch{return reply(404,'not_found');}
  if(url.pathname!==`/api/content/dev/workspaces/${workspaceId}/generation-jobs`||url.search)return reply(404,'not_found');
  let principal:Principal|null;
  try{principal=await verify(request);}catch{return reply(401,'unauthorized');}
  if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))return reply(401,'unauthorized');
  const size=Number(request.headers.get('content-length')??0);
  if(!Number.isFinite(size)||size>2048)return reply(413,'payload_too_large');
  let body:unknown;
  try{const raw=await request.text();if(raw.length>2048)return reply(413,'payload_too_large');body=JSON.parse(raw);}catch{return reply(400,'invalid_json');}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,'invalid_request');
  const data=body as Record<string,unknown>;
  if(Object.keys(data).sort().join(',')!=='campaignId,idempotencyKey'||typeof data.campaignId!=='string'||!UUID.test(data.campaignId)||typeof data.idempotencyKey!=='string'||!KEY.test(data.idempotencyKey))return reply(400,'invalid_request');
  try{
   const job=await submitRestrictedContentJob(principal,{workspaceId,campaignId:data.campaignId,idempotencyKey:data.idempotencyKey});
   return new Response(JSON.stringify({data:job}),{status:202,headers:{'content-type':'application/json','cache-control':'no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff'}});
  }catch(e){return reply(e instanceof ContentReadDenied?404:503,e instanceof ContentReadDenied?'not_found':'jobs_unavailable');}
 };
}
