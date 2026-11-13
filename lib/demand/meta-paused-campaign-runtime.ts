import 'server-only';
import {demandMetaPilotRuntime as runtime} from './meta-direct-runtime.ts';
import {createPilotLedger} from './meta-pilot-ledger.ts';
import {createPausedCampaignService} from './meta-paused-campaign-service.ts';
import {createPausedCampaignHttpHandler} from './meta-paused-campaign-http.ts';
import {createDemandPreviewCreativeReview} from './content-creative-preview.ts';
import {readContentCreativeOriginal} from '../portfolio/content-review-source.mjs';
import {demandCampaignBudgetCap} from './meta-paused-campaign-plan.ts';

const creativeReview = createDemandPreviewCreativeReview({
  demandPreviewEnabled: runtime.enabled,
  env: process.env,
  readOriginal: readContentCreativeOriginal,
  authorizeBoth: runtime.authorizeContentDemand,
  maximumBudgetMinor: () => demandCampaignBudgetCap(process.env),
  now: Date.now,
});

export const handleDemandPausedCampaign=createPausedCampaignHttpHandler({enabled:runtime.enabled,
  authorize:runtime.authorize,creativeReview,service:(_scope,reauthorize)=>createPausedCampaignService({
    environment:process.env,reauthorize,now:Date.now,
    verifyLedger:runtime.verifyCampaignLedger,
    ledger:(scope,sha)=>createPilotLedger(runtime.campaignTransaction,scope,{pausedCampaignPlanSha256:sha})})});
