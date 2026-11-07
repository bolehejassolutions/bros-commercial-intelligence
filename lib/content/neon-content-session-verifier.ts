/** BROS CONTENT DEV session verifier. Delegates session validation to the existing
 * Neon Auth / Better Auth service; never trusts request-supplied principal IDs.
 * A CONTENT membership check is still mandatory inside the restricted DB adapter.
 * This is an injectable boundary, not an enabled public API route.
 */
type Principal=Readonly<{userId:string;authenticated:true}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Fetcher=typeof fetch;
export function createContentNeonSessionVerifier(authBaseUrl:string, fetcher:Fetcher=fetch){
 let base:URL;
 try{base=new URL(authBaseUrl);}catch{throw new Error('Invalid CONTENT Neon Auth URL');}
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||
    !base.hostname.endsWith('.neon.tech')||!base.pathname.endsWith('/auth'))
  throw new Error('Invalid CONTENT Neon Auth origin');
 const endpoint=new URL(base.toString().replace(/\/$/,'')+'/get-session');
 return async function verifyContentSession(request:Request):Promise<Principal|null>{
  const cookie=request.headers.get('cookie');
  if(!cookie||cookie.length>8192)return null;
  // Accept only the canonical Better Auth session cookie names. Reject
  // duplicates and malformed values rather than forwarding arbitrary cookies.
  // Cookies from the Neon Auth host are not automatically shared with a
  // separate Vercel domain; a trusted same-origin auth bridge is required.
  const allowed=new Set(['better-auth.session_token','__Secure-better-auth.session_token']);
  const tokens=cookie.split(';').map(v=>v.trim()).filter(Boolean);
  const selected=tokens.filter(v=>allowed.has(v.split('=')[0]));
  if(selected.length!==1)return null;
  const separator=selected[0].indexOf('=');
  const value=selected[0].slice(separator+1);
  if(separator<1||!value||value.length>4096||/[\\s;,]/.test(value))return null;
  const scopedCookie=selected[0];
  let response:Response;
  try{response=await fetcher(endpoint.toString(),{
   method:'GET',headers:{cookie:scopedCookie,accept:'application/json'},
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)
  });}catch{return null;}
  if(!response.ok)return null;
  let data:unknown;
  try{data=await response.json();}catch{return null;}
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const result=data as Record<string,unknown>;
  const user=result.user;
  const session=result.session;
  if(!user||typeof user!=='object'||Array.isArray(user)||
     !session||typeof session!=='object'||Array.isArray(session))return null;
  const id=(user as Record<string,unknown>).id;
  if(typeof id!=='string'||!UUID.test(id))return null;
  const sessionUserId=(session as Record<string,unknown>).userId;
  if(sessionUserId!==id)return null;
  return Object.freeze({userId:id,authenticated:true});
 };
}
