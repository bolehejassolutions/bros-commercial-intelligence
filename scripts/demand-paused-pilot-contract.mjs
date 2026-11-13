/**
 * Immutable, non-executable staging contract for the one owner-approved pilot.
 * This is a plan/check only: it never calls Meta and never grants launch authority.
 */
export const APPROVED_DEMAND_META_PILOT = Object.freeze({
  accountId: "act_1997776120879476",
  campaignId: "120251158023300697",
  country: "MY",
  ageMin: 21,
  ageMax: 45,
  lifetimeBudgetMinor: 14000,
  durationDays: 7,
  creativeCount: 2,
  requiredStatus: "PAUSED",
});

const ownData = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(key => typeof key === "string" &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
};

/**
 * Provider readback is advisory until independently authenticated by the
 * caller. In particular, a matching JSON object cannot prove a Meta write.
 */
export function assessPausedPilotReadback(value) {
  const fail = reason => Object.freeze({
    status: "BLOCKED", reason, providerAuthenticated: false,
    paidPurchaseVerified: false, activationAllowed: false,
  });
  try {
    if (!ownData(value)) return fail("UNREADABLE_READBACK");
    const expected = APPROVED_DEMAND_META_PILOT;
    for (const key of ["accountId","campaignId","country","ageMin","ageMax",
      "lifetimeBudgetMinor","durationDays","creativeCount"]) {
      if (!Object.hasOwn(value,key) || value[key] !== expected[key])
        return fail("APPROVED_SCOPE_MISMATCH");
    }
    if (value.status !== "PAUSED" || value.effectiveStatus !== "PAUSED")
      return fail("NOT_PAUSED");
    if (value.budgetRemainingMinor !== 14000)
      return fail("BUDGET_NOT_INTACT");
    return Object.freeze({
      status: "PAUSED_CANDIDATE_UNATTESTED",
      reason: "AUTHENTICATED_PROVIDER_READBACK_AND_PAID_PURCHASE_JOIN_REQUIRED",
      providerAuthenticated: false,
      paidPurchaseVerified: false,
      activationAllowed: false,
    });
  } catch {
    return fail("UNREADABLE_READBACK");
  }
}
