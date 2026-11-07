/** Principal verified by the first-party Neon Auth Next.js server integration.
 * Never use body/query/header user IDs or client-provided JWT claims.
 * The restricted database adapter independently enforces tenant membership.
 */
type Principal=Readonly<{userId:string;authenticated:true}>;
type SessionProvider=Readonly<{getSession:()=>Promise<unknown>}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value:unknown):Record<string,unknown>|null{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
}
export function createContentSdkSessionVerifier(auth:SessionProvider){
 if(!auth||typeof auth.getSession!=='function')throw new Error('Missing Neon Auth server');
 return async function verifyContentSession(_request:Request):Promise<Principal|null>{
  let raw:unknown;
  try{raw=await auth.getSession();}catch{return null;}
  const response=object(raw);
  if(!response)return null;
  const sessionData=object(Object.prototype.hasOwnProperty.call(response,'data')?response.data:response);
  if(!sessionData)return null;
  const user=object(sessionData.user),session=object(sessionData.session);
  if(!user||!session||typeof user.id!=='string'||!UUID.test(user.id)||
     session.userId!==user.id)return null;
  if(session.expiresAt!==undefined&&session.expiresAt!==null){
   const expiry=session.expiresAt instanceof Date?session.expiresAt.getTime():
    typeof session.expiresAt==='string'?Date.parse(session.expiresAt):NaN;
   if(!Number.isFinite(expiry)||expiry<=Date.now())return null;
  }
  return Object.freeze({userId:user.id,authenticated:true});
 };
}
