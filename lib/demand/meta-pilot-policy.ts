import { createHash } from "node:crypto";

/** One existing owner-approved campaign. This is not a general campaign builder. */
export const PILOT = Object.freeze({
  key: "bros-sell-v5-140myr-7d-20261102-v1",
  account: "act_1997776120879476", campaign: "120251158023300697",
  page: "108099141072511", pixel: "1636131111400103",
  budgetMinor: 14000, durationSeconds: 7 * 86400,
  authority: "https://docs.google.com/document/d/1XPD2sCnOJeFpXfXtwsu44kgrwhl2L03wfajpxOIck2I/edit",
});
export const ASSETS = Object.freeze({
  a: Object.freeze({
    name: "BROS_SELL_META_A_NEW_SELLER_APPROVED.jpg", size: 465709,
    sha256: "742aac6771fb834c151b38a4f2dbd3369206b3d8bddea172e10087122f0e4219",
    headline: "Produk dah ada. Jom mula menjual.", description: "Panduan jualan praktikal.",
    url: "https://bros.bolehejas.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign=bros_sell_acq_v2_20261027&utm_content=creative_a_pelanggan_pertama",
    text: "Produk dah ada. Bila ada orang mesej tanya harga, hati rasa seronok — tapi kadang-kadang terus tak tahu nak mula dari mana.\n\nNak jawab harga dulu? Nak tanya keperluan dia? Nak terangkan apa yang dia akan dapat?\n\nBelajar menjual tak semestinya bermula dengan ayat yang hebat. Ia boleh bermula dengan satu soalan yang betul.\n\nBROS SELL™ membantu penjual Malaysia belajar memahami pelanggan, menyusun tawaran dan memilih langkah seterusnya — dengan panduan 36 bab, 12 peta visual dan worksheet praktikal.\n\nMula dengan lebih jelas. Tak perlu jadi penjual paling petah.\n\nRM100, bayaran sekali.\nMenjelaskan, bukan Memujuk.",
  }),
  b: Object.freeze({
    name: "BROS_SELL_META_B_EXISTING_SELLER_APPROVED.jpg", size: 452762,
    sha256: "37845fa92439901e418623d09f9f9da32738a9ed25a6b8680210670c574018c7",
    headline: "Prospek senyap? Fahami dulu.", description: "Panduan susulan yang jelas.",
    url: "https://bros.bolehejas.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign=bros_sell_acq_v2_20261027&utm_content=creative_b_saya_fikir_dulu",
    text: "‘Saya fikir dulu ya.’\n\nLepas tu, perbualan jadi senyap.\n\nKita dah luang masa menjawab, dah cuba jelaskan tawaran. Tapi belum tentu harga yang jadi masalah. Mungkin pelanggan masih nak bandingkan pilihan, perlukan maklumat atau belum sesuai membeli sekarang.\n\nSebelum hantar follow-up yang sama, cuba tanya:\n‘Ada bahagian tentang tawaran ini yang anda mahu saya jelaskan lagi?’\n\nBROS SELL™ menyediakan panduan, peta visual dan worksheet seperti BROS 5Q untuk membantu penjual memahami situasi prospek serta merancang tindakan susulan dengan lebih tersusun.\n\nBukan untuk memaksa keputusan. Untuk membantu pelanggan lebih jelas dan memudahkan kerja menjual.\n\nRM100, bayaran sekali.\nMenjelaskan, bukan Memujuk.",
  }),
});
export const STAGE_STEPS = ["image_a", "image_b", "adset", "creative_a", "ad_a", "creative_b", "ad_b"] as const;
export type StageStep = typeof STAGE_STEPS[number];
export type Step = StageStep | "campaign" | "refresh_flight" | "activate_ad_a" | "activate_ad_b" | "activate_adset" | "activate_campaign";
export type StepResult = Readonly<{ id?: string; hash?: string; start?: string; end?: string; status?: string }>;
export type Snapshot = Partial<Record<Step, StepResult>>;
export const policyDigest = createHash("sha256").update(JSON.stringify({ PILOT, ASSETS })).digest("hex");
export function validateAsset(key: "a" | "b", bytes: Uint8Array) {
  const expected = ASSETS[key];
  if (bytes.byteLength !== expected.size ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
    throw Error("APPROVED_V5_ASSET_REQUIRED");
}
export function verifiedIdentities(env: NodeJS.ProcessEnv) {
  const beneficiary = env.BROS_DEMAND_META_BENEFICIARY_ID;
  const payer = env.BROS_DEMAND_META_PAYER_ID;
  const valid = (v: unknown): v is string => typeof v === "string" && /^[0-9]{6,30}$/.test(v) &&
    ![PILOT.page, PILOT.pixel, PILOT.campaign, PILOT.account.slice(4), "2091328444802994"].includes(v);
  if (!valid(beneficiary) || !valid(payer)) throw Error("VERIFIED_MALAYSIA_IDENTITIES_REQUIRED");
  // Shape validation does not certify the identities; Meta must accept them.
  return { universal_beneficiary: beneficiary, universal_payer: payer };
}
export function adsetBody(identities: ReturnType<typeof verifiedIdentities>, at: number) {
  const start = new Date(at + 15 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const end = new Date(Date.parse(start) + PILOT.durationSeconds * 1000).toISOString();
  return {
    name: "BROS SELL | V5 | MY 21-45 | FEEDS | 7D", campaign_id: PILOT.campaign,
    start_time: start, end_time: end, status: "PAUSED",
    billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE",
    promoted_object: { pixel_id: PILOT.pixel, custom_event_type: "PURCHASE" },
    targeting: { geo_locations: { countries: ["MY"] }, age_min: 21, age_max: 45,
      publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream"],
      targeting_automation: { advantage_audience: 0 } },
    regional_regulated_categories: ["MALAYSIA_UNIVERSAL"], regional_regulation_identities: identities,
    // CBO lifetime budget belongs to the existing campaign. No ad-set budget.
  };
}
export function creativeBody(key: "a" | "b", imageHash: string) {
  if (!/^[a-f0-9]{32}$/i.test(imageHash)) throw Error("META_IMAGE_HASH_REQUIRED");
  const a = ASSETS[key];
  return { name: "BROS SELL | APPROVED V5 | " + key.toUpperCase(),
    object_story_spec: { page_id: PILOT.page, link_data: {
      link: a.url, image_hash: imageHash, message: a.text, name: a.headline, description: a.description,
      call_to_action: { type: "LEARN_MORE", value: { link: a.url } },
    } } };
}

/** Server operator attestation is an explicit launch gate, not independent tracking proof. */
export function launchAttestation(env: NodeJS.ProcessEnv, now: number) {
  try {
    const r = JSON.parse(env.BROS_DEMAND_META_LAUNCH_QA_RECEIPT ?? "null");
    const when = Date.parse(r?.verifiedAt);
    if (r?.policyDigest !== policyDigest || r?.campaign !== PILOT.campaign ||
        r?.amountMinor !== 10000 || r?.currency !== "MYR" || r?.pixel !== PILOT.pixel ||
        r?.checkoutVerified !== true || r?.purchaseDedupVerified !== true || r?.utmVerified !== true ||
        typeof r?.paidOrderReference !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(r.paidOrderReference) ||
        typeof r?.purchaseEventId !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(r.purchaseEventId) ||
        typeof r?.evidenceUrl !== "string" ||
        !/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit$/.test(r.evidenceUrl) ||
        !Number.isFinite(when) || when > now || now - when > 86400000) throw Error();
    return { evidenceUrl: r.evidenceUrl as string, verifiedAt: r.verifiedAt as string };
  } catch { throw Error("CURRENT_REAL_PURCHASE_QA_RECEIPT_REQUIRED"); }
}
