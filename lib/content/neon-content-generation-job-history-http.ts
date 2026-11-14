/** Read-only CONTENT job-history boundary; no generation or credit mutation. */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
type Principal=Readonly<{userId:string;authenticated:true}>;
type Verify=(request:Request)=>Promise<Principal|null>;
type Read=(principal:Principal,workspaceId:string,campaignId:string,limit:number)=>Promise<unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers:{
 'content-type':'application/json','cache-control':'no-store',
 'x-content-type-options':'nosniff','vary':'Cookie, Authorization'}});
export function createContentJobHistoryGet(verify:Verify,read:Read){
 if(typeof verify!=='function'||typeof read!=='function')throw new Error('Missing restricted job history dependencies');
 return async(request:Request,workspaceId:string):Promise<Response>=>{
  if(request.method!=='GET')return reply(405,{error:'method_not_allowed'});
  if(!UUID.test(workspaceId))return reply(404,{error:'not_found'});
  let url:URL;
  try{url=new URL(request.url);}catch{return reply(404,{error:'not_found'});}
  if(url.pathname!==`/api/content/dev/workspaces/${workspaceId}/generation-jobs`)
   return reply(404,{error:'not_found'});
  let principal:Principal|null;
  try{principal=await verify(request);}catch{return reply(401,{error:'unauthorized'});}
  if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))
   return reply(401,{error:'unauthorized'});
  const campaign=url.searchParams.getAll('campaign'),limits=url.searchParams.getAll('limit');
  if(campaign.length!==1||!UUID.test(campaign[0])||limits.length>1||
   [...url.searchParams.keys()].some(k=>k!=='campaign'&&k!=='limit'))
   return reply(400,{error:'invalid_query'});
  const limit=limits.length===0?25:Number(limits[0]);
  if(limits.length===1&&!/^[1-9][0-9]?$/.test(limits[0])||
   !Number.isInteger(limit)||limit<1||limit>50)return reply(400,{error:'invalid_limit'});
  try{
   const jobs=await read(Object.freeze({userId:principal.userId,authenticated:true}),
     workspaceId,campaign[0],limit);
   if(!Array.isArray(jobs)||jobs.length>limit)return reply(503,{error:'jobs_unavailable'});
   return reply(200,{data:{campaignId:campaign[0],jobs}});
  }catch(e){
   if(e instanceof ContentReadDenied)return reply(404,{error:'not_found'});
   return reply(503,{error:'jobs_unavailable'});
  }
 };
}
