/** Authenticated CONTENT DEV application; no public production cutover. */
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {createContentSdkSessionVerifier} from '@/lib/content/neon-content-sdk-session.ts';
import ContentWorkspaceClient from './content-workspace-client';
export const dynamic='force-dynamic';
export default async function ContentDevPage(){
 const verify=createContentSdkSessionVerifier(getContentNeonAuth());
 const principal=await verify(new Request('https://content.invalid/dev'));
 if(!principal)return <main style={{padding:32,fontFamily:'system-ui'}}>
  <h1>BROS CONTENT</h1><p>Sesi Neon Auth belum disahkan.</p>
  <a href="/content/dev/sign-in">Log masuk ke DEVELOPMENT</a>
 </main>;
 return <ContentWorkspaceClient/>;
}
