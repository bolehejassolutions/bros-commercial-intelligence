/**
 * Private Business OS — DEV-only, non-routed composition of three independent
 * security boundaries. No database connections, secrets, HTTP route or MCP host.
 * All dependencies MUST be server-owned, with real IdP backchannel verification
 * and direct restricted READ ONLY SQL transactions. Never pass user-controlled
 * identity, grants or a BROS/admin connection.
 */
import { createDevEvidenceReadHandler } from "./assistant-evidence-authenticated-read.ts";
import { createBusinessOsDevIdentityVerifier } from "./assistant-evidence-neon-dev-identity.ts";
import type { TrustedIntrospection, IdentityConfig } from "./assistant-evidence-neon-dev-identity.ts";
import { createBusinessOsDevMembershipChecker } from "./assistant-evidence-neon-dev-membership.ts";
import type { MembershipTransaction } from "./assistant-evidence-neon-dev-membership.ts";
import { createBusinessOsDevScopedEvidenceReader } from "./assistant-evidence-neon-dev-read.ts";
import type { BusinessOsReadTransaction } from "./assistant-evidence-neon-dev-read.ts";

export type BusinessOsDevServerDependencies = Readonly<{
  /** Authenticated live IdP session introspection; no decode-only JWT or cached grants. */
  introspect: TrustedIntrospection;
  identity: IdentityConfig;
  /** Direct bci_dev_membership_reader LOGIN, pinned READ ONLY transaction. */
  membershipTransaction: MembershipTransaction;
  /** Independent direct bci_dev_private_reader LOGIN, pinned READ ONLY transaction. */
  evidenceTransaction: BusinessOsReadTransaction;
  now?: () => number;
}>;

/** A callable handler, NOT a registered route. Default deny in production. */
export function createBusinessOsDevComposedReadHandler(deps: BusinessOsDevServerDependencies) {
  if (!deps || typeof deps.introspect !== "function" ||
      typeof deps.membershipTransaction !== "function" ||
      typeof deps.evidenceTransaction !== "function") {
    throw Error("Business OS DEV dependencies unavailable");
  }
  const verifyBearerToken = createBusinessOsDevIdentityVerifier(
    deps.introspect, deps.identity, deps.now
  );
  const hasEvidenceReadGrant = createBusinessOsDevMembershipChecker(deps.membershipTransaction);
  const listScopedReceipts = createBusinessOsDevScopedEvidenceReader(deps.evidenceTransaction);
  return createDevEvidenceReadHandler({
    verifyBearerToken, hasEvidenceReadGrant, listScopedReceipts, now: deps.now,
  });
}
