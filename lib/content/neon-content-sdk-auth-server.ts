/** Dedicated, Preview-only BROS CONTENT Neon Auth server. Never use BCI's Supabase session. */
import 'server-only';
import {createNeonAuth} from '@neondatabase/auth/next/server';
import {isContentDevPreviewEnabled} from './neon-content-auth-gate.ts';

export function getContentNeonAuth(){
 if(!isContentDevPreviewEnabled(process.env.VERCEL_ENV,process.env.CONTENT_DEV_API_ENABLED))throw new Error('CONTENT DEV is disabled');
 const baseUrl=process.env.CONTENT_NEON_AUTH_URL;
 const secret=process.env.CONTENT_NEON_AUTH_COOKIE_SECRET;
 if(!baseUrl||!secret||secret.length<32)throw new Error('CONTENT Neon Auth is not configured');
 let url:URL;
 try{url=new URL(baseUrl);}catch{throw new Error('Invalid CONTENT Neon Auth URL');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    !url.hostname.endsWith('.neon.tech')||!url.pathname.endsWith('/auth'))
  throw new Error('Invalid CONTENT Neon Auth origin');
 return createNeonAuth({baseUrl:url.toString(),cookies:{secret,sessionDataTtl:60}});
}
