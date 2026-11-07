/** DEV-only workspace discovery HTTP boundary; no guessed principal or tenant. */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
type Principal=Readonly<{userId:string;authenticated:true}>;
type Verify=(request:Request)=>Promise<Principal|null>;
type Read=(principal:Principal)=>Promise<unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{
 status,headers:{'content-type':'application/json','cache-control':'no-store',
 'x-content-type-options':'nosniff','vary':'Cookie, Authorization'}
});
export function createContentWorkspaceIndexGet(verify:Verify,read:Read){
 if(typeof verify!=='function'||typeof read!=='function')throw new Error('Missing CONTENT dependencies');
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='GET')return reply(405,'method_not_allowed');
  let principal:Principal|null;
  try{principal=await verify(request);}catch{return reply(401,'unauthorized');}
  if(!principal||principal.authenticated!==true||!UUID.test(principal.userId))
   return reply(401,'unauthorized');
  try{
   const data=await read(Object.freeze({userId:principal.userId,authenticated:true}));
   return new Response(JSON.stringify({data}),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
    'x-content-type-options':'nosniff','vary':'Cookie, Authorization'
   }});
  }catch(e){
   if(e instanceof ContentReadDenied)return reply(404,'not_found');
   return reply(503,'workspace_unavailable');
  }
 };
}
