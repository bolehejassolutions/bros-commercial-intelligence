/** Fail-closed gate for a GET-only Meta management preflight. Never authorizes ad writes. */
export function isVerifiedDemandMetaManagementPreflight(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    return value.status === "READY" && value.reason === "VERIFIED" && value.mode === "write" &&
      value.accountId === "act_1997776120879476" &&
      value.businessPortfolioId === "2091328444802994" &&
      value.appId === "1315572270590189" &&
      value.providerFailure === null && value.checks?.token === true && value.checks?.app === true && value.checks?.account === true;
  } catch { return false; }
}
