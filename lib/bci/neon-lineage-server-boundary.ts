import "server-only";
/**
 * Internal BCI shared-core write boundary. Not an HTTP route.
 *
 * A caller must supply a pinned, directly authenticated restricted LOGIN
 * transaction and the authoritative membership lookup already used by the
 * private evidence reader. No browser-provided tenant, role or user identity.
 * This bridge intentionally does NOT configure a database credential, expose
 * an endpoint, or enable writes on any deployed environment.
 */
import { createNeonAuthPrincipalVerifier } from "./neon-auth-principal.ts";
import {
  BciLineageWriteDenied,
  createAuthenticatedBciLineageWriter,
  type LineageTransaction,
} from "./neon-lineage-writer.ts";
import { isNeonPreviewEnabled } from "./neon-preview-handler.ts";
import type { BciLineageProduct, BciLineageRecord } from "./internal-lineage.ts";

type Grant = Readonly<{
  principalId: string;
  tenantId: string;
  product: BciLineageProduct;
  active: true;
}>;
type Dependencies = Readonly<{
  membershipsFor: (principalId: string, product: BciLineageProduct) => Promise<readonly Grant[]>;
  transaction: LineageTransaction;
}>;
type Append = Readonly<{
  product: BciLineageProduct;
  records: readonly BciLineageRecord[];
}>;

const authBase =
  "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const issuer = new URL(authBase).origin;
const verify = createNeonAuthPrincipalVerifier({
  issuer,
  audience: issuer,
  jwksUrl: `${authBase}/.well-known/jwks.json`,
  approvedOperator: { email: "rasymokh@gmail.com" },
});

/**
 * Future internal worker integration point. Explicitly disabled unless the
 * existing protected exact-branch Preview gate AND a separate write-only
 * feature flag are both enabled. Never call from a public route by default.
 *
 * The supplied transaction must use createPgLineageWriteTransaction with a
 * password-authenticated bci_dev_lineage_writer session; its existing
 * session_user/current_user and privilege checks reject admin SET ROLE.
 */
export function createNeonLineageServerBoundary(deps: Dependencies) {
  if (!deps || typeof deps.membershipsFor !== "function" ||
      typeof deps.transaction !== "function") throw new BciLineageWriteDenied();
  return async (bearerToken: unknown, request: Append) => {
    if (!isNeonPreviewEnabled(process.env) ||
        process.env.BCI_NEON_DEV_PRIVATE_WRITES !== "enabled") {
      throw new BciLineageWriteDenied();
    }
    try {
      // Signature, approved verified operator, issuer, audience and expiry are
      // checked on every call; never cache a bearer token or principal.
      const principal = await verify(bearerToken);
      return await createAuthenticatedBciLineageWriter({
        authenticate: async () => principal,
        membershipsFor: deps.membershipsFor,
        transaction: deps.transaction,
      })(request);
    } catch {
      // Never surface provider exceptions, bearer tokens, SQL or credentials.
      throw new BciLineageWriteDenied();
    }
  };
}
