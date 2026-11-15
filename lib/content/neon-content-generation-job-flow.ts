/** CONTENT DEV integration seam: submission, worker execution and history.
 * This is a real orchestration contract, not a deployed route. Connections must
 * be injected by an independently approved tenant-restricted adapter.
 * No provider, scheduler, credits, grants or production activation.
 */
import {createContentJobSubmissionPost} from './neon-content-generation-job-submission-http.ts';
import {processContentDevJob} from './neon-content-generation-job-worker.ts';
import {listContentCampaignJobs} from './neon-content-generation-job-lifecycle.ts';
import type {JobQuery,JobRow} from './neon-content-generation-job-lifecycle.ts';

type Principal=Readonly<{userId:string;authenticated:true}>;
type Scope=Readonly<{tenantId:string}>;
type Dependencies={
 verify:(request:Request)=>Promise<Principal|null>;
 authorize:(principal:Principal,workspaceId:string,campaignId:string)=>Promise<Scope|null>;
 submitDb:(principal:Principal,tenantId:string)=>Promise<JobQuery>;
 historyDb:(principal:Principal,tenantId:string)=>Promise<JobQuery>;
 workerDb:(tenantId:string)=>Promise<JobQuery>;
 execute:(job:Readonly<JobRow>)=>Promise<void>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status:number,body:object){return new Response(JSON.stringify(body),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',
 'vary':'Cookie, Authorization'
}});}
export function createContentDevJobFlow(deps:Dependencies){
 for(const fn of ['verify','authorize','submitDb','historyDb','workerDb','execute'] as const)
  if(typeof deps?.[fn]!=='function')throw new Error('Missing job-flow dependency');
 const submit=createContentJobSubmissionPost(deps.verify,deps.authorize,deps.submitDb);
 return {
  submit,
  async history(request:Request,workspaceId:string,campaignId:string):Promise<Response>{
   if(request.method!=='GET')return json(405,{error:'method_not_allowed'});
   if(!UUID.test(workspaceId)||!UUID.test(campaignId))return json(404,{error:'not_found'});
   let url:URL;
   try{url=new URL(request.url);}catch{return json(404,{error:'not_found'});}
   if(url.pathname!==`/api/content/dev/workspaces/${workspaceId}/campaigns/${campaignId}/generation-jobs`||url.search)
    return json(404,{error:'not_found'});
   let principal:Principal|null;
   try{principal=await deps.verify(request);}catch{return json(401,{error:'unauthorized'});}
   if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))
    return json(401,{error:'unauthorized'});
   try{
    const scope=await deps.authorize(principal,workspaceId,campaignId);
    if(!scope||!UUID.test(scope.tenantId))return json(404,{error:'not_found'});
    const db=await deps.historyDb(principal,scope.tenantId);
    const jobs=await listContentCampaignJobs(db,{tenantId:scope.tenantId,campaignId,principalId:principal.userId});
    if(jobs.some(job=>job.tenant_id!==scope.tenantId||job.campaign_id!==campaignId||job.requested_by!==principal.userId))
     return json(503,{error:'history_unavailable'});
    return json(200,{data:jobs.map(job=>({id:job.id,campaignId:job.campaign_id,status:job.status,attempts:job.attempts,errorCode:job.error_code}))});
   }catch{return json(503,{error:'history_unavailable'});}
  },
  async process(tenantId:string,jobId:string,recoverExpired=false){
   if(!UUID.test(tenantId)||!UUID.test(jobId))throw new Error('Invalid worker scope');
   const db=await deps.workerDb(tenantId);
   return processContentDevJob({db,tenantId,jobId,work:deps.execute,recoverExpired});
  }
 };
}
