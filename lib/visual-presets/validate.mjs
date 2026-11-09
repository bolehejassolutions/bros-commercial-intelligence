import {getVisualPreset, VISUAL_PRESET_VERSION} from "./catalog.mjs";

/**
 * Pre-generation brief gate, not a media generator or editorial approval.
 * @param {object} brief  Explicit tenant-scoped creative request
 * @param {object} scope  Authenticated tenant/brand and verified asset manifest
 * @returns {{ok:boolean, errors:string[], candidate:object|null}}
 */
export function validateVisualBrief(brief,scope) {
  const errors=[];
  if (!brief || typeof brief!=="object" || !scope || typeof scope!=="object")
    return {ok:false,errors:["explicit_brief_and_scope_required"],candidate:null};
  if (!scope.tenantId || !scope.brandId || !brief.tenantId || !brief.brandId ||
      scope.tenantId!==brief.tenantId || scope.brandId!==brief.brandId)
    errors.push("tenant_or_brand_scope_mismatch");
  const preset=getVisualPreset(brief.presetId);
  if (!preset) errors.push("unknown_preset");
  if (preset && !preset.ratios.includes(brief.aspectRatio))
    errors.push("unsupported_aspect_ratio");
  if (!brief.contentJob || typeof brief.contentJob!=="string" || !brief.contentJob.trim())
    errors.push("content_job_required");
  if (brief.logoAssetId) {
    const approved=Array.isArray(scope.approvedLogoAssets) &&
      scope.approvedLogoAssets.some(x=>x?.assetId===brief.logoAssetId && x.approved===true &&
        x.tenantId===scope.tenantId && x.brandId===scope.brandId);
    if (!approved) errors.push("unapproved_or_cross_brand_logo");
  }
  if (brief.presetId==="REAL_PRODUCT_SHOWCASE") {
    const s=brief.sourceScreenshot;
    // A brief is untrusted input: its verifiedBytes flag is not evidence.
    // Match an independently verified, tenant/brand-scoped source manifest.
    const original=Array.isArray(scope.verifiedScreenshotAssets) &&
      scope.verifiedScreenshotAssets.some(x=>x?.assetId===s?.assetId &&
        x.sha256===s?.sha256 && /^[a-f0-9]{64}$/i.test(x.sha256??"") &&
        Number.isSafeInteger(x.bytes) && x.bytes>0 &&
        x.verifiedBytes===true && x.original===true &&
        x.tenantId===scope.tenantId && x.brandId===scope.brandId);
    if (!original || s.tenantId!==scope.tenantId || s.brandId!==scope.brandId)
      errors.push("verified_in_scope_original_screenshot_required");
  }
  if (brief.presetId==="FOUNDER_EDITORIAL_PORTRAIT") {
    const approved=Array.isArray(scope.authorizedLikenessAssets) &&
      scope.authorizedLikenessAssets.some(x=>x?.assetId===brief.likenessAssetId &&
        x.tenantId===scope.tenantId && x.brandId===scope.brandId &&
        x.useAuthorized===true);
    if (!approved) errors.push("likeness_permission_required");
  }
  if (brief.claims!==undefined) {
    if (!Array.isArray(brief.claims)) errors.push("claims_array_required");
    else if (brief.claims.some(x=>!x || typeof x.text!=="string" || !x.text.trim() ||
      !x.evidenceId || !Array.isArray(scope.verifiedClaimEvidence) ||
      !scope.verifiedClaimEvidence.some(e=>e?.evidenceId===x.evidenceId &&
        e.tenantId===scope.tenantId && e.brandId===scope.brandId &&
        e.verified===true && e.text===x.text)))
      errors.push("unverified_claim");
  }
  // Only a brief candidate can be produced. Real media byte decode, editorial
  // approval, provider disclosure and paid/publish grants are independent gates.
  if (errors.length) return {ok:false,errors,candidate:null};
  return {ok:true,errors:[],candidate:{
    tenantId:scope.tenantId, brandId:scope.brandId, presetId:preset.id,
    presetVersion:VISUAL_PRESET_VERSION, aspectRatio:brief.aspectRatio,
    contentJob:brief.contentJob, status:"DRAFT_NOT_GENERATED",
    mediaQa:"NOT_RUN", editorialApproval:"NOT_GRANTED",
    publishAuthorized:false, adAuthorized:false
  }};
}
