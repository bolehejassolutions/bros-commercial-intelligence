import { NextRequest, NextResponse } from "next/server";
import { adminSession, forbidden, NO_STORE } from "@/lib/marketing-operator/server-auth";
import { inspectMetaConnection } from "@/lib/marketing-operator/meta-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Inspect server-held credentials; never accept tokens, secrets or an app/account ID from the client. */
export async function GET(request: NextRequest) {
  const auth = await adminSession();
  if (!auth) return forbidden();
  const mode = request.nextUrl.searchParams.get("mode") ?? "read";
  if (mode !== "read" && mode !== "write") return forbidden("Invalid connection check mode.", 400);
  const connection = await inspectMetaConnection(mode);
  return NextResponse.json({ connection, campaignChanges: 0, authorizedSpendMYR: 0 }, {
    status: connection.status === "READY" ? 200 : 423, headers: NO_STORE,
  });
}
