/** Authenticated workspace list for BROS CONTENT DEV. No tenant-wide access. */
import {createContentSdkSessionVerifier} from '@/lib/content/neon-content-sdk-session.ts';
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {isContentDevPreviewEnabled} from '@/lib/content/neon-content-auth-gate.ts';
import {createRestrictedContentAdapters} from '@/lib/content/neon-content-restricted-adapters.ts';
import {createContentWorkspaceIndexGet} from '@/lib/content/neon-content-workspace-index-http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!isContentDevPreviewEnabled(process.env.VERCEL_ENV,process.env.CONTENT_DEV_API_ENABLED))
  return new Response(JSON.stringify({error:'not_found'}),{status:404,headers:{'cache-control':'no-store'}});
 let adapter:ReturnType<typeof createRestrictedContentAdapters>|undefined;
 try{
  const verify=createContentSdkSessionVerifier(getContentNeonAuth());
  adapter=createRestrictedContentAdapters('content_dev_reader_v2');
  if(!adapter.listWorkspaces)throw new Error('Reader unavailable');
  return await createContentWorkspaceIndexGet(verify,adapter.listWorkspaces)(request);
 }catch{return new Response(JSON.stringify({error:'unavailable'}),{status:503,headers:{'cache-control':'no-store'}});}
 finally{if(adapter)await adapter.close();}
}
