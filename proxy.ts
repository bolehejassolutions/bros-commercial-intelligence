import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { usesNeonPreviewAuthentication } from "@/lib/bci/neon-preview-route-policy";
import {requiresContentNeonMiddleware,isContentDevPreviewEnabled} from "@/lib/content/neon-content-auth-gate";
import {getContentNeonAuth} from "@/lib/content/neon-content-sdk-auth-server";

export async function proxy(request: NextRequest) {
  // Dedicated CONTENT Neon Auth is isolated to Preview and its exact own paths.
  // SDK middleware exchanges OAuth verifiers and manages same-origin cookies.
  // Never let the legacy BCI Supabase proxy consume CONTENT auth callbacks.
  if (requiresContentNeonMiddleware(request.nextUrl.pathname)) {
    if (!isContentDevPreviewEnabled(process.env.VERCEL_ENV,process.env.CONTENT_DEV_API_ENABLED))
      return new NextResponse(null,{status:404,headers:{'cache-control':'no-store'}});
    try {
      return await getContentNeonAuth().middleware({loginUrl:'/content/dev/sign-in'})(request);
    } catch {
      return new NextResponse(null,{status:503,headers:{'cache-control':'no-store'}});
    }
  }
  // Existing BCI Neon preview routes and CONTENT DEV workspace APIs enforce
  // identity and RLS at their own server-side handlers.
  if (usesNeonPreviewAuthentication(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
