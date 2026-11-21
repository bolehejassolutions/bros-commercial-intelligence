/** Authenticated CONTENT DEV application; no public production cutover. */
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {createContentSdkSessionVerifier} from '@/lib/content/neon-content-sdk-session.ts';
import {isContentDevPreviewEnabled} from '@/lib/content/neon-content-auth-gate.ts';
import ContentWorkspaceClient from './content-workspace-client';
export const dynamic='force-dynamic';
export default async function ContentDevPage(){
 const verify=createContentSdkSessionVerifier(getContentNeonAuth());
 const principal=await verify(new Request('https://content.invalid/dev'));
 if(!principal)return <main style={{padding:32,fontFamily:'system-ui'}}>
  <h1>BROS CONTENT</h1><p>Sesi Neon Auth belum disahkan.</p>
  <a href="/content/dev/sign-in">Log masuk ke DEVELOPMENT</a>
 </main>;
 const preview = isContentDevPreviewEnabled(process.env.VERCEL_ENV, process.env.CONTENT_DEV_API_ENABLED);
 return <ContentWorkspaceClient
  jobHistoryEnabled={preview && process.env.CONTENT_DEV_JOB_HISTORY_ENABLED === 'true'}
  jobSubmissionEnabled={preview && process.env.CONTENT_DEV_JOB_SUBMISSION_ENABLED === 'true'}
 />;
}
