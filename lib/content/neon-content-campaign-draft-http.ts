/** DEV-only campaign draft boundary. No generation, credits or payments.
 * The injected writer MUST enforce tenant membership and RLS inside one DB transaction.
 */
import { ContentReadDenied } from './neon-content-workspace-reader.ts';
type Principal = Readonly<{userId:string;authenticated:true}>;
type Verify = (request:Request)=>Promise<Principal|null>;
type Create = (principal:Principal, workspaceId:string, draft:Draft, key:string)=>Promise<unknown>;
type Draft = {product_service:string;audience:string;description:string;problem:string;objective:string;duration_days:number;platforms:string[]};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Cookie, Authorization'}});
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const allowedPlatforms=new Set(['facebook','instagram','tiktok','youtube','linkedin','whatsapp','threads','x']);
export function createContentCampaignDraftPost(verify:Verify,create:Create) {
 if(typeof verify!=='function'||typeof create!=='function')throw new Error('Missing secure dependencies');
 return async (request:Request,workspaceId:string):Promise<Response>=>{
  if(request.method!=='POST')return reply(405,'method_not_allowed');
  if(!UUID.test(workspaceId))return reply(404,'not_found');
  // Reject cross-origin browser writes before authentication or database access.
  // Browser clients must use same-origin requests; no permissive CORS is offered.
  const origin=request.headers.get('origin');
  const fetchSite=request.headers.get('sec-fetch-site');
  if(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none')return reply(403,'forbidden_origin');
  if(origin){let expected:string;try{expected=new URL(request.url).origin;}catch{return reply(403,'forbidden_origin');}
   if(origin!==expected)return reply(403,'forbidden_origin');}

  let principal:Principal|null;
  try{principal=await verify(request);}catch{return reply(401,'unauthorized');}
  if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))return reply(401,'unauthorized');
  const type=request.headers.get('content-type')||'';
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(type))return reply(415,'unsupported_media_type');
  const key=request.headers.get('idempotency-key');
  if(!key||!/^[a-zA-Z0-9_-]{12,180}$/.test(key))return reply(400,'invalid_idempotency_key');
  const length=Number(request.headers.get('content-length')||0);
  if(length>16384)return reply(413,'payload_too_large');
  let input:unknown;
  try{const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>16384)return reply(413,'payload_too_large');input=JSON.parse(raw);}
  catch{return reply(400,'invalid_json');}
  if(!input||typeof input!=='object'||Array.isArray(input))return reply(400,'invalid_draft');
  const v=input as Record<string,unknown>;
  const allowed=['product_service','audience','description','problem','objective','duration_days','platforms'];
  if(Object.keys(v).some(k=>!allowed.includes(k)))return reply(400,'invalid_draft');
  const str=(k:string,max:number,required=false)=>typeof v[k]==='string'&&(v[k] as string).length<=max&&(!required||(v[k] as string).trim().length>0);
  if(!str('product_service',200,true)||!str('audience',2000,true))return reply(400,'invalid_draft');
  if(['description','problem','objective'].some(k=>own(v,k)&&!str(k,k==='description'?4000:2000)))return reply(400,'invalid_draft');
  if(own(v,'duration_days')&&(!Number.isInteger(v.duration_days)||Number(v.duration_days)<1||Number(v.duration_days)>90))return reply(400,'invalid_draft');
  if(!Array.isArray(v.platforms)||v.platforms.length<1||v.platforms.length>8||
     v.platforms.some((p:unknown)=>typeof p!=='string'||!allowedPlatforms.has(p.toLowerCase()))||
     new Set((v.platforms as string[]).map(p=>p.toLowerCase())).size!==v.platforms.length)
   return reply(400,'invalid_draft');
  const draft:Draft={product_service:(v.product_service as string).trim(),audience:(v.audience as string).trim(),
   description:(v.description as string)||'',problem:(v.problem as string)||'',objective:(v.objective as string)||'',
   duration_days:(v.duration_days as number)||7,platforms:(v.platforms as string[]).map(p=>p.toLowerCase())};
  try{
   const data=await create(Object.freeze({userId:principal.userId,authenticated:true}),workspaceId,Object.freeze(draft),key);
   return new Response(JSON.stringify({data}),{status:201,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch(error){
   if(error instanceof ContentReadDenied)return reply(404,'not_found');
   return reply(503,'draft_unavailable');
  }
 };
}
