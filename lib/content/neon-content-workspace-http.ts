/** Authenticated BROS CONTENT workspace HTTP boundary (DEV).
 * Wiring requires a real server-side identity verifier and restricted Neon transaction.
 * Never accept a principal, tenant, or role from request body/query/headers.
 */
import { ContentReadDenied,ContentReadIncomplete } from './neon-content-workspace-reader.ts';
type Principal = Readonly<{userId:string;authenticated:true}>;
type Reader = (principal:Principal, workspaceId:string)=>Promise<unknown>;
type VerifySession = (request:Request)=>Promise<Principal|null>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response=(status:number,body:object)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','vary':'Cookie, Authorization'}});
export function createContentWorkspaceGet(verifySession:VerifySession,readWorkspace:Reader) {
 if(typeof verifySession!=='function'||typeof readWorkspace!=='function')throw new Error('Missing secure dependencies');
 return async (request:Request, workspaceId:string):Promise<Response>=>{
  if(request.method!=='GET')return response(405,{error:'method_not_allowed'});
  if(!UUID.test(workspaceId))return response(404,{error:'not_found'});
  let principal:Principal|null;
  try {principal=await verifySession(request);}catch{return response(401,{error:'unauthorized'});}
  if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))
   return response(401,{error:'unauthorized'});
  try {
   const data=await readWorkspace(Object.freeze({userId:principal.userId,authenticated:true}),workspaceId);
   return response(200,{data});
  }catch(error){
   if(error instanceof ContentReadDenied)return response(404,{error:'not_found'});
   if(error instanceof ContentReadIncomplete)return response(503,{error:'workspace_incomplete'});
   // Never expose SQL, identity or tenant details through an HTTP error.
   return response(503,{error:'workspace_unavailable'});
  }
 };
}
