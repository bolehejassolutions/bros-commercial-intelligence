import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // DEMAND exact paths have their own Preview-only JWT/membership gates.
  // Keep this independent of BCI's bypass so both draft branches merge cleanly.
  if (request.nextUrl.pathname === "/internal/demand-meta-test" ||
      request.nextUrl.pathname === "/api/internal/demand-meta" ||
      request.nextUrl.pathname === "/api/internal/demand-meta-evidence" ||
      request.nextUrl.pathname === "/api/internal/demand-meta-diagnosis") {
    return NextResponse.next({ request });
  }
  // BCI's separate Neon JWT + membership gate remains unchanged.
  if (request.nextUrl.pathname === "/api/internal/neon-evidence" ||
      request.nextUrl.pathname === "/internal/neon-preview") {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
