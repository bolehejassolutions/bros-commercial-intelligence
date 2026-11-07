/** Minimal authenticated recovery landing page; not a functional parity claim. */
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {createContentSdkSessionVerifier} from '@/lib/content/neon-content-sdk-session.ts';
export const dynamic='force-dynamic';
export default async function ContentDevPage(){
 const verify=createContentSdkSessionVerifier(getContentNeonAuth());
 const principal=await verify(new Request('https://content.invalid/dev'));
 return <main style={{maxWidth:720,margin:'5rem auto',padding:24,fontFamily:'system-ui'}}>
  <p style={{letterSpacing:2,fontSize:12}}>BROS CONTENT · NEON RECOVERY</p>
  <h1>Development workspace</h1>
  {principal?<p>Neon Auth session verified. Workspace access still requires database tenant membership.</p>:
   <p>Session unavailable. <a href="/content/dev/sign-in">Sign in</a> to continue.</p>}
  <p>This isolated Preview is not the original production BROS CONTENT experience. Generation, credits and publishing remain disabled pending functional validation.</p>
 </main>;
}
