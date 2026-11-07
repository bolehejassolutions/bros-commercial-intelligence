/**
 * Contract-only reproduction of original BROS CONTENT campaign generation.
 * Callers supply the AI transport; there is NO DB mutation, credit reservation,
 * job dispatch, billing, or publishing in this module.
 */
import {
 validateCampaignInput,validateCampaignPlan,validateQualityReview,
 buildCampaignPlanPrompt,buildQualityPrompt,evaluateQualityGate,
 ContentGenerationRejected,
 type CampaignInput,type CampaignPlan,type QualityReview,
} from './neon-content-generation-contract.ts';
import {campaignPlanSchema,qualityReviewSchema} from './neon-content-structured-provider.ts';

type Generator=(prompt:string,schema:Readonly<Record<string,unknown>>,name:string)=>Promise<unknown>;
export type PreparedCampaign=Readonly<{
 plan:CampaignPlan;review:QualityReview;
 gate:ReturnType<typeof evaluateQualityGate>;
 readyForPersistence:boolean;
 operation:'preview_only';
}>;
export function createContentCampaignPlanner(generate:Generator){
 if(typeof generate!=='function')throw new Error('Missing structured generation provider');
 return async function planCampaign(rawInput:unknown,businessDna:unknown):Promise<PreparedCampaign>{
  // Validate everything before the first costly API call.
  const input:CampaignInput=validateCampaignInput(rawInput);
  const prompt=buildCampaignPlanPrompt(input,businessDna);
  let rawPlan:unknown;
  try{rawPlan=await generate(prompt,campaignPlanSchema,'bros_campaign');}
  catch{throw new ContentGenerationRejected('Campaign generation failed');}
  const plan=validateCampaignPlan(rawPlan);
  let rawReview:unknown;
  try{rawReview=await generate(buildQualityPrompt(input,businessDna,plan),qualityReviewSchema,'bros_qc');}
  catch{throw new ContentGenerationRejected('Quality review failed');}
  const review=validateQualityReview(rawReview);
  const gate=evaluateQualityGate(review);
  // Even if QC passes, never mint credits or persist a campaign from this module.
  // A future feature-flagged worker must add an isolated, independently verified
  // membership + idempotent financial/persistence transaction first.
  return Object.freeze({plan,review,gate,readyForPersistence:false,operation:'preview_only'});
 };
}
