/** Preview-only same-origin Neon Auth bridge for the isolated BROS CONTENT app.
 * Keep disabled until a distinct cookie secret and approved Preview flag are configured.
 * No /auth (legacy Supabase callback) or production domain is modified.
 */
import {getContentNeonAuth} from '@/lib/content/neon-content-sdk-auth-server.ts';
import {isContentDevPreviewEnabled} from '@/lib/content/neon-content-auth-gate.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{
 status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export async function GET(request:Request){
 if(!isContentDevPreviewEnabled(process.env))return reply(404,'not_found');
 try{return await getContentNeonAuth().handler().GET(request);}
 catch{return reply(503,'auth_unavailable');}
}
export async function POST(request:Request){
 if(!isContentDevPreviewEnabled(process.env))return reply(404,'not_found');
 try{return await getContentNeonAuth().handler().POST(request);}
 catch{return reply(503,'auth_unavailable');}
}
