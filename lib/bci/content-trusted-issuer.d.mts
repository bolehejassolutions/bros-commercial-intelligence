export function createBciContentTrustedIssuer(deps: {
  trustedPublicKeys: Map<string, import("node:crypto").KeyObject>;
  authenticateReviewer: () => Promise<{userId:string;authenticated:boolean}>;
  readReviewerAuthority: (id:string, product:string) => Promise<unknown>;
  recomputeOriginalMedia: (...args:unknown[]) => Promise<unknown>;
  verifyContentSourceContext: (...args:unknown[]) => Promise<boolean>;
  verifyCompleteScriptSourceContext: (...args:unknown[]) => Promise<boolean>;
  writeTransaction: unknown;
  readTransaction: unknown;
  now: () => number;
}): Readonly<{
  issueScript: (request:unknown) => Promise<import("./neon-content-issuance-service.ts").ContentIssuanceResult>;
}>;
