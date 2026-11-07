import "server-only";
import { demandMetaPilotRuntime as runtime } from "./meta-direct-runtime.ts";
import { createPilotLedger } from "./meta-pilot-ledger.ts";
import { createPilotService } from "./meta-pilot-service.ts";
import { createPilotHttpHandler } from "./meta-pilot-http.ts";

export const handleDemandMetaPilot = createPilotHttpHandler({
  enabled: runtime.enabled,
  authorize: runtime.authorize,
  service: (_scope, reauthorize) => createPilotService({
    environment: process.env, readToken: runtime.readToken,
    ledger: scope => createPilotLedger(runtime.transaction, scope),
    reauthorize, now: Date.now,
  }),
});
