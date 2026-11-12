/**
 * BROS-owned instance configuration. Do NOT use this as a default for
 * independent BROS CONTENT customer workspaces.
 * Approval: https://docs.google.com/document/d/1JAECi1KYEBZ1VaQBIdZtOkvSXjnjHKSXCIvz1MQIvB4/edit
 */
export const BROS_VISUAL_INSTANCE = Object.freeze({
  brandId: "bros-sell",
  locale: "ms-MY",
  doctrine: "Menjelaskan, bukan Memujuk",
  publicName: "BROS SELL",
  primaryPresets: Object.freeze(["SELL_MANGA_STORY","NATURAL_MY_UGC","SYSTEM_EXPLAINER","REAL_PRODUCT_SHOWCASE"]),
  secondaryPresets: Object.freeze(["EXPRESSIVE_ANIME","FOUNDER_EDITORIAL_PORTRAIT"]),
  proposedPilotCounts: Object.freeze({
    SELL_MANGA_STORY:4, NATURAL_MY_UGC:4, SYSTEM_EXPLAINER:3, REAL_PRODUCT_SHOWCASE:1
  }),
});
export const BROS_PRIMARY_PROMPTS = Object.freeze({
  SELL_MANGA_STORY: "Create an original three-panel vertical retro hand-inked manga story in a believable Malaysian SME setting: concrete seller problem, human misunderstanding, then one practical non-pushy reframe. Original characters, natural Bahasa Melayu Malaysia speech bubbles, clear ink lines and crop-safe margins. Do not recreate logos or invent testimonials.",
  NATURAL_MY_UGC: "Create a credible candid smartphone-style photograph of a fictional Malaysian small-business operator facing one everyday selling situation. Authentic local environment, natural lighting, genuine expressions, unstaged framing. Reserve space for a separate verified headline; no stock-photo styling, invented customer proof or generated logos.",
  SYSTEM_EXPLAINER: "Create a clean three-stage educational diagram background. For this approved BROS instance use midnight navy, cream and restrained gold. Reserve exact copy, figures and branding for deterministic overlay from approved sources. Ample spacing, high contrast, no invented metrics.",
  REAL_PRODUCT_SHOWCASE: "Compose the provided genuine immutable BROS product screenshot inside a realistic legible device image. Preserve exact interface, copy and displayed features. Restrained navy studio backdrop and gentle light, no fabricated UI, logo, customer results or endorsements.",
});
export function validateBrosSellCopy(copy) {
  if (typeof copy !== "string" || !copy.trim()) return ["copy_required"];
  const errors=[];
  if (/closing\s+os/i.test(copy)) errors.push("retired_public_lockup");
  if (/\b(kebutuhan|ongkir|diskon|nggak)\b/i.test(copy)) errors.push("non_malaysian_register");
  return errors;
}
