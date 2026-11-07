/** DEV-only authenticated CONTENT campaign draft API; no generation or credits. */
import {createContentNeonSessionVerifier} from '@/lib/content/neon-content-session-verifier.ts';
import {createRestrictedContentAdapters} from '@/lib/content/neon-content-restricted-adapters.ts';
import {createContentCampaignDraftPost} from '@/lib/content/neon-content-campaign-draft-http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 if(process.env.VERCEL_ENV!=='development'||process.env.CONTENT_DEV_API_ENABLED!=='true')
  return new Response(JSON.stringify({error:'not_found'}),{status:404,headers:{'cache-control':'no-store'}});
 const base=process.env.CONTENT_NEON_AUTH_URL;
 if(!base)return new Response(JSON.stringify({error:'unavailable'}),{status:503});
 let adapter:ReturnType<typeof createRestrictedContentAdapters>|undefined;
 try{
  const verify=createContentNeonSessionVerifier(base);
  adapter=createRestrictedContentAdapters('content_dev_draft_writer_v2');
  if(!adapter.createDraft)throw new Error('Writer unavailable');
  const handler=createContentCampaignDraftPost(verify,adapter.createDraft);
  return await handler(request,(await context.params).workspaceId);
 }catch{return new Response(JSON.stringify({error:'unavailable'}),{status:503,headers:{'cache-control':'no-store'}});}
 finally{if(adapter)await adapter.close();}
}
