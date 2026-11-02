import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { usesNeonPreviewAuthentication } from "@/lib/bci/neon-preview-route-policy";

export async function proxy(request: NextRequest) {
  // Each exact route retains its own Preview-only Neon JWT/membership boundary.
  // Never redirect a Neon bearer request to the separate Supabase login.
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
