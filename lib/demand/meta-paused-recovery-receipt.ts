import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import type {PilotScope} from './meta-pilot-ledger.ts';
const domain='BROS_DEMAND_RECONCILED_CREATIVE_RETRY_V1\n';
const reasons=['ABSENT_AND_META_APP_DEVELOPMENT_MODE','ABSENT_AND_META_VALIDATION_PASSED'] as const;
type RecoveryReason=typeof reasons[number];
const deny=():never=>{throw Error('PAUSED_RECOVERY_RECEIPT_DENIED');};
export function creativeRetryNamespace(planSha256:string){
  if(!/^[a-f0-9]{64}$/.test(planSha256))return deny();
  return createHash('sha256').update(domain+'single-retry\n'+planSha256).digest('hex');
}
/** Machine evidence of exhaustive absence + Meta's development-mode rejection
 * or a fresh successful validation after that external blocker is resolved.
 * This is not a human approval, Meta credential, or permission to activate.
 */
export function sealCreativeRecovery(scope:PilotScope,sha:string,secret:string,at:number,reason:RecoveryReason='ABSENT_AND_META_APP_DEVELOPMENT_MODE'){
  if(!secret||secret.length<16||!/^[a-f0-9]{64}$/.test(sha)||!Number.isFinite(at)||!reasons.includes(reason))return deny();
  const payload=Buffer.from(JSON.stringify({version:1,tenantId:scope.tenantId,principalId:scope.principalId,
    planSha256:sha,reason,issuedAt:at,expiresAt:at+45*60000})).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update(domain+payload).digest('base64url');
}
export function verifyCreativeRecovery(scope:PilotScope,sha:string,receipt:string,secret:string,at:number){
  if(!secret||secret.length<16||typeof receipt!=='string'||receipt.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(receipt))return deny();
  const [payload,signature]=receipt.split('.'),expected=createHmac('sha256',secret).update(domain+payload).digest(),actual=Buffer.from(signature,'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return deny();
  let p;try{p=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{return deny();}
  if(!p||Object.keys(p).length!==7||p.version!==1||p.tenantId!==scope.tenantId||p.principalId!==scope.principalId||
    p.planSha256!==sha||!reasons.includes(p.reason)||!Number.isSafeInteger(p.issuedAt)||
    p.expiresAt!==p.issuedAt+45*60000||p.issuedAt>at||p.expiresAt<=at)return deny();
}
