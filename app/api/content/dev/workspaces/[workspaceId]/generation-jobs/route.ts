/** Preview-only campaign job submission and history, independently gated by role and feature. */
import {createContentSdkSessionVerifier} from '@/lib/content/neon-content-sdk-session.ts';
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {isContentDevPreviewEnabled} from '@/lib/content/neon-content-auth-gate.ts';
import {createRestrictedContentAdapters} from '@/lib/content/neon-content-restricted-adapters.ts';
import {createContentJobHistoryGet} from '@/lib/content/neon-content-generation-job-history-http.ts';
import {createContentJobPost} from '@/lib/content/neon-content-generation-job-submission-http.ts';
import {createContentJobSubmitter} from '@/lib/content/neon-content-job-submitter-server.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
 if(!isContentDevPreviewEnabled(process.env.VERCEL_ENV,process.env.CONTENT_DEV_API_ENABLED)||
   process.env.CONTENT_DEV_JOB_HISTORY_ENABLED!=='true')
  return new Response(JSON.stringify({error:'not_found'}),{status:404,headers:{'cache-control':'no-store'}});
 let adapter:ReturnType<typeof createRestrictedContentAdapters>|undefined;
 try{
  const verify=createContentSdkSessionVerifier(getContentNeonAuth());
  adapter=createRestrictedContentAdapters('content_dev_reader_v2');
  if(!adapter.listJobs)throw new Error('Reader unavailable');
  const handler=createContentJobHistoryGet(verify,adapter.listJobs);
  return await handler(request,(await context.params).workspaceId);
 }catch{return new Response(JSON.stringify({error:'unavailable'}),{status:503,headers:{'cache-control':'no-store'}});}
 finally{if(adapter)await adapter.close();}
}

export async function POST(request:Request, context:{params:Promise<{workspaceId:string}>}) {
 if (!isContentDevPreviewEnabled(process.env.VERCEL_ENV,process.env.CONTENT_DEV_API_ENABLED) ||
      process.env.CONTENT_DEV_JOB_SUBMISSION_ENABLED !== 'true')
  return new Response(JSON.stringify({error:'not_found'}), {status:404, headers:{'cache-control':'no-store'}});
 try {
  const verify = createContentSdkSessionVerifier(getContentNeonAuth());
  const handler = createContentJobPost(verify, async (principal, input) => {
   const writer = createContentJobSubmitter();
   try { return await writer.submit(principal,input); }
   finally { await writer.close(); }
  });
  return await handler(request, (await context.params).workspaceId);
 } catch {
  return new Response(JSON.stringify({error:'unavailable'}), {status:503, headers:{'cache-control':'no-store'}});
 }
}
