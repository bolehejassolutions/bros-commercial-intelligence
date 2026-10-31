import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // This exact internal endpoint has its own Preview-only Neon JWT + membership
  // boundary. Do not make it depend on the separate Supabase operator session.
  if (request.nextUrl.pathname === "/api/internal/neon-evidence" ||
      request.nextUrl.pathname === "/internal/neon-preview" ||
      // DEMAND has an exact-branch UI gate and a separate JWT/membership API gate.
      // Bypass only these exact paths, never the broader Supabase BCI login.
      request.nextUrl.pathname === "/internal/demand-meta-test" ||
      request.nextUrl.pathname === "/api/internal/demand-meta") {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
