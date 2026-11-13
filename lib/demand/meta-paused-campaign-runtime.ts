import 'server-only';
import {demandMetaPilotRuntime as runtime} from './meta-direct-runtime.ts';
import {createPilotLedger} from './meta-pilot-ledger.ts';
import {createPausedCampaignService} from './meta-paused-campaign-service.ts';
import {createPausedCampaignHttpHandler} from './meta-paused-campaign-http.ts';
import {createDemandCreativeReview} from './creative-review.ts';
import {createDemandContentCreativeReader,demandContentReusePublicKey} from './content-creative-reader.ts';
import {demandCampaignBudgetCap} from './meta-paused-campaign-plan.ts';

function creativeReview() {
  if (process.env.BROS_DEMAND_CONTENT_CREATIVE_REVIEW !== 'enabled') return null;
  const key = demandContentReusePublicKey(process.env.BROS_DEMAND_CONTENT_REUSE_PUBLIC_KEY);
  if (!key) return null;
  return createDemandCreativeReview({
    authorizeBoth: runtime.authorizeContentDemand,
    readerFor: (scope, jwt) => createDemandContentCreativeReader(scope, jwt, key),
    maximumBudgetMinor: () => demandCampaignBudgetCap(process.env),
    now: Date.now,
  });
}

export const handleDemandPausedCampaign=createPausedCampaignHttpHandler({enabled:runtime.enabled,
  authorize:runtime.authorize,creativeReview,service:(_scope,reauthorize)=>createPausedCampaignService({
    environment:process.env,reauthorize,now:Date.now,
    verifyLedger:runtime.verifyCampaignLedger,
    ledger:(scope,sha)=>createPilotLedger(runtime.campaignTransaction,scope,{pausedCampaignPlanSha256:sha})})});
