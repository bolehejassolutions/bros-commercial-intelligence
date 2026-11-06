import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { usesNeonPreviewAuthentication } from "@/lib/bci/neon-preview-route-policy";
import { isDemandMetaPreviewUiEnabled } from "@/lib/demand/meta-preview-ui-gate";

export async function proxy(request: NextRequest) {
  // Only the DEMAND Preview hostname uses the DEMAND landing page.
  // Keep BCI Production and its independent Supabase login unchanged.
  if (
    request.nextUrl.hostname.toLowerCase() === "brosdemand.bolehejas.com" &&
    request.nextUrl.pathname === "/" &&
    isDemandMetaPreviewUiEnabled(process.env)
  ) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/internal/demand-meta-test";
    return NextResponse.redirect(destination, 307);
  }

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
