import { reconcileDemandPurchaseEvidence } from './attribution-evidence.mjs';
const deny=()=>{throw new Error('DEMAND_SETTLEMENT_SOURCE_UNVERIFIED');};
const record=(v,keys)=>v!==null&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&'value'in d&&d.enumerable;});
const id=/^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
const utc=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
/** Read-only boundary: trusted server adapter required; client evidence is never payment proof. */
export async function observeDemandSettlements({tenantId,currency,readSettlements,authorizeTenant,now}){
 if(typeof tenantId!=='string'||!id.test(tenantId)||currency!=='MYR'||typeof readSettlements!=='function'||typeof authorizeTenant!=='function'||!utc(now))deny();
 let authorized;try{authorized=await authorizeTenant(tenantId);}catch{deny();}
 if(authorized!==true)deny();
 let response;try{response=await readSettlements({tenantId,limit:500});}catch{deny();}
 try {
 if(!record(response,['tenantId','source','retrievedAt','complete','orders'])||response.tenantId!==tenantId||response.source!=='HITPAY_AUTHENTICATED_SERVER'||response.complete!==true||!utc(response.retrievedAt)||Date.parse(response.retrievedAt)>Date.parse(now)||Date.parse(now)-Date.parse(response.retrievedAt)>900000||!Array.isArray(response.orders)||response.orders.length>500)deny();
 // Settlement must not postdate the trusted adapter's retrieval snapshot.
 // A future-dated payment must never inflate recognized revenue.
 for(const order of response.orders){
  if(!record(order,['tenantId','orderRef','providerOrderId','status','amountMinor','currency','settledAt']))deny();
  if(order.status==='SETTLED'&&(!utc(order.settledAt)||Date.parse(order.settledAt)>Date.parse(response.retrievedAt)))deny();
 }
 let evidence=reconcileDemandPurchaseEvidence({tenantId,currency},[],response.orders);
 return Object.freeze({state:'SERVER_ADAPTER_EVIDENCE_UNVERIFIED_PROVIDER',sourceRetrievedAt:response.retrievedAt,settledHitPayOrders:evidence.settledHitPayOrders,settledRevenueMinor:evidence.settledRevenueMinor,verifiedSettledRevenueMinor:null,providerAuthenticationVerified:false,tenantAuthorizationVerifiedForProvider:false,evidenceDigest:evidence.evidenceDigest,metaWriteAllowed:false});
 } catch { deny(); }
}
