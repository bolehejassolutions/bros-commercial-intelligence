/** DEV-only idempotent campaign drafts through first-party Neon Auth and restricted RLS. */
import {createContentSdkSessionVerifier} from '@/lib/content/neon-content-sdk-session.ts';
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {isContentDevPreviewEnabled} from '@/lib/content/neon-content-auth-gate.ts';
import {createRestrictedContentAdapters} from '@/lib/content/neon-content-restricted-adapters.ts';
import {createContentCampaignDraftPost} from '@/lib/content/neon-content-campaign-draft-http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 if(!isContentDevPreviewEnabled(process.env))
  return new Response(JSON.stringify({error:'not_found'}),{status:404,headers:{'cache-control':'no-store'}});
 let adapter:ReturnType<typeof createRestrictedContentAdapters>|undefined;
 try{
  const verify=createContentSdkSessionVerifier(getContentNeonAuth());
  adapter=createRestrictedContentAdapters('content_dev_draft_writer_v2');
  if(!adapter.createDraft)throw new Error('Writer unavailable');
  const handler=createContentCampaignDraftPost(verify,adapter.createDraft);
  return await handler(request,(await context.params).workspaceId);
 }catch{return new Response(JSON.stringify({error:'unavailable'}),{status:503,headers:{'cache-control':'no-store'}});}
 finally{if(adapter)await adapter.close();}
}
