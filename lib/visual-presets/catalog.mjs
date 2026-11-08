/**
 * Configurable visual formats. This catalog is brand-agnostic:
 * no BROS-specific defaults, provider calls, authorization or publishing.
 * Approval reference: Primary Drive BROS Visual Preset Library (2026-11-08).
 */
const items = [
  ["SELL_MANGA_STORY", "primary", "illustration", "9:16", ["9:16", "4:5"], "Three-act original sequential seller story; no imitated IP"],
  ["NATURAL_MY_UGC", "primary", "photograph", "9:16", ["9:16", "4:5", "1:1"], "Credible candid scene; no invented testimonial or documentary proof"],
  ["SYSTEM_EXPLAINER", "primary", "diagram", "4:5", ["4:5", "1:1", "16:9"], "Verified workflow; deterministic factual text and numerical overlays"],
  ["REAL_PRODUCT_SHOWCASE", "primary", "product_screenshot", "16:9", ["16:9", "4:5", "9:16"], "Genuine immutable UI screenshot; no fabricated feature"],
  ["EXPRESSIVE_ANIME", "secondary", "illustration", "9:16", ["9:16", "4:5"], "Original expressive characters; entertainment not proof"],
  ["FOUNDER_EDITORIAL_PORTRAIT", "secondary", "portrait", "4:5", ["4:5", "1:1"], "Permissioned likeness reference; no fabricated endorsement"],
];
export const VISUAL_PRESETS = Object.freeze(items.map(([id,tier,kind,defaultAspectRatio,ratios,description]) =>
  Object.freeze({id,tier,kind,defaultAspectRatio,ratios:Object.freeze(ratios),description})
));
export function getVisualPreset(id) {
  return VISUAL_PRESETS.find((item) => item.id === id) ?? null;
}
export const VISUAL_PRESET_VERSION = "1.0.0";
