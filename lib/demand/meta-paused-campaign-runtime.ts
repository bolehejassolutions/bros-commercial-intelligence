import 'server-only';
import {demandMetaPilotRuntime as runtime} from './meta-direct-runtime.ts';
import {createPilotLedger} from './meta-pilot-ledger.ts';
import {createPausedCampaignService} from './meta-paused-campaign-service.ts';
import {createPausedCampaignHttpHandler} from './meta-paused-campaign-http.ts';
export const handleDemandPausedCampaign=createPausedCampaignHttpHandler({enabled:runtime.enabled,
  authorize:runtime.authorize,service:(_scope,reauthorize)=>createPausedCampaignService({
    environment:process.env,reauthorize,now:Date.now,
    verifyLedger:runtime.verifyCampaignLedger,
    ledger:(scope,sha)=>createPilotLedger(runtime.campaignTransaction,scope,{pausedCampaignPlanSha256:sha})})});
