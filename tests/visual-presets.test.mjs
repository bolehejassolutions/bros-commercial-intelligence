import test from "node:test";
import assert from "node:assert/strict";
import {VISUAL_PRESETS,getVisualPreset} from "../lib/visual-presets/catalog.mjs";
import {BROS_VISUAL_INSTANCE,BROS_PRIMARY_PROMPTS,validateBrosSellCopy} from "../lib/visual-presets/bros-instance.mjs";
import {validateVisualBrief} from "../lib/visual-presets/validate.mjs";
const screenshot={assetId:"ui-1",sha256:"b".repeat(64),verifiedBytes:true,tenantId:"tenant-a",brandId:"bros-sell"};
const scope={tenantId:"tenant-a",brandId:"bros-sell",
 approvedLogoAssets:[{assetId:"approved-1",tenantId:"tenant-a",brandId:"bros-sell",approved:true}],
 verifiedScreenshotAssets:[{...screenshot,bytes:2048,original:true}],
 verifiedClaimEvidence:[{evidenceId:"source-1",text:"Verified internal capability",tenantId:"tenant-a",brandId:"bros-sell",verified:true}],
 authorizedLikenessAssets:[{assetId:"founder-1",tenantId:"tenant-a",brandId:"bros-sell",useAuthorized:true}]
};
const base={tenantId:"tenant-a",brandId:"bros-sell",presetId:"SELL_MANGA_STORY",aspectRatio:"9:16",contentJob:"Explain a real customer objection"};
function gate(changes={},s=scope){return validateVisualBrief({...base,...changes},s);}
test("catalog has six unique presets and four primary styles",()=>{
 assert.equal(VISUAL_PRESETS.length,6);
 assert.equal(new Set(VISUAL_PRESETS.map(x=>x.id)).size,6);
 assert.equal(VISUAL_PRESETS.filter(x=>x.tier==="primary").length,4);
 assert.equal(BROS_VISUAL_INSTANCE.primaryPresets.length,4);
 assert.equal(Object.values(BROS_VISUAL_INSTANCE.proposedPilotCounts).reduce((a,b)=>a+b,0),12);
});
test("brand-specific prompts are separate from generic catalog",()=>{
 assert.ok(BROS_PRIMARY_PROMPTS.SELL_MANGA_STORY.includes("Malaysian"));
 assert.equal(getVisualPreset("SELL_MANGA_STORY").kind,"illustration");
 assert.ok(!JSON.stringify(VISUAL_PRESETS).includes("BROS SELL"));
});
test("successful gate creates only ungenerated, unauthorized draft candidate",()=>{
 const r=gate();assert.equal(r.ok,true);assert.equal(r.candidate.status,"DRAFT_NOT_GENERATED");
 assert.equal(r.candidate.mediaQa,"NOT_RUN");assert.equal(r.candidate.publishAuthorized,false);assert.equal(r.candidate.adAuthorized,false);
});
test("missing scope and cross-tenant/brand request fail closed",()=>{
 assert.equal(validateVisualBrief(base,{}).ok,false);
 assert.ok(gate({tenantId:"tenant-b"}).errors.includes("tenant_or_brand_scope_mismatch"));
 assert.ok(gate({brandId:"other-brand"}).errors.includes("tenant_or_brand_scope_mismatch"));
});
test("unknown preset and unsupported ratio fail",()=>{
 assert.ok(gate({presetId:"FAKE_STYLE"}).errors.includes("unknown_preset"));
 assert.ok(gate({aspectRatio:"21:9"}).errors.includes("unsupported_aspect_ratio"));
});
test("unverified or cross-brand logo is rejected even for a valid creative",()=>{
 assert.ok(gate({logoAssetId:"unapproved"}).errors.includes("unapproved_or_cross_brand_logo"));
 assert.ok(gate({logoAssetId:"approved-1"},{...scope,brandId:"other-brand"}).errors.includes("tenant_or_brand_scope_mismatch"));
 assert.equal(gate({logoAssetId:"approved-1"}).ok,true);
});
test("product showcase requires actual verified scoped screenshot provenance",()=>{
 const v={presetId:"REAL_PRODUCT_SHOWCASE",aspectRatio:"16:9"};
 assert.ok(gate(v).errors.includes("verified_in_scope_original_screenshot_required"));
 assert.ok(gate({...v,sourceScreenshot:{assetId:"ui-1",sha256:"b".repeat(64),verifiedBytes:true,tenantId:"other",brandId:"bros-sell"}}).errors.includes("verified_in_scope_original_screenshot_required"));
 assert.equal(gate({...v,sourceScreenshot:screenshot}).ok,true);
 assert.ok(gate({...v,sourceScreenshot:screenshot},{...scope,verifiedScreenshotAssets:[]}).errors.includes("verified_in_scope_original_screenshot_required"));
 assert.ok(gate({...v,sourceScreenshot:{...screenshot,sha256:"c".repeat(64)}}).errors.includes("verified_in_scope_original_screenshot_required"));
 assert.ok(gate({...v,sourceScreenshot:screenshot},{...scope,verifiedScreenshotAssets:[{...screenshot,bytes:0,original:true}]}).errors.includes("verified_in_scope_original_screenshot_required"));
 assert.ok(gate({...v,sourceScreenshot:screenshot},{...scope,verifiedScreenshotAssets:[{...screenshot,bytes:2048,original:true,tenantId:"tenant-b"}]}).errors.includes("verified_in_scope_original_screenshot_required"));
});
test("all factual claims must carry independently verified evidence",()=>{
 assert.ok(gate({claims:[{text:"Ten sales every day"}]}).errors.includes("unverified_claim"));
 assert.equal(gate({claims:[{text:"Verified internal capability",evidenceId:"source-1",verified:true}]}).ok,true);
 assert.ok(gate({claims:[{text:"Ten sales every day",evidenceId:"source-1",verified:true}]}).errors.includes("unverified_claim"));
 assert.ok(gate({claims:[{text:"Verified internal capability",evidenceId:"source-1",verified:true}]},{...scope,verifiedClaimEvidence:[]}).errors.includes("unverified_claim"));
});
test("portrait requires consent for identifiable likeness",()=>{
 assert.ok(gate({presetId:"FOUNDER_EDITORIAL_PORTRAIT",aspectRatio:"4:5"}).errors.includes("likeness_permission_required"));
 assert.ok(gate({presetId:"FOUNDER_EDITORIAL_PORTRAIT",aspectRatio:"4:5",likenessUseAuthorized:true}).errors.includes("likeness_permission_required"));
 assert.equal(gate({presetId:"FOUNDER_EDITORIAL_PORTRAIT",aspectRatio:"4:5",likenessAssetId:"founder-1"}).ok,true);
 assert.ok(gate({presetId:"FOUNDER_EDITORIAL_PORTRAIT",aspectRatio:"4:5",likenessAssetId:"founder-1"},{...scope,authorizedLikenessAssets:[]}).errors.includes("likeness_permission_required"));
});
test("BROS SELL Malay language and public lockup gate",()=>{
 assert.deepEqual(validateBrosSellCopy("BROS SELL — Menjelaskan, bukan Memujuk"),[]);
 assert.ok(validateBrosSellCopy("Closing OS — kebutuhan pelanggan").includes("retired_public_lockup"));
 assert.ok(validateBrosSellCopy("Closing OS — kebutuhan pelanggan").includes("non_malaysian_register"));
});
