/**
 * BCI-owned untrusted DEMAND HitPay reconciliation projection.
 * Existing Neon DEV evidence provider enum has no "hitpay" entry.
 * No credentials, auth, DB writes, settlement, entitlement or attribution.
 */
import { createHash } from "node:crypto";
import { normalizeEvidenceEnvelope } from "./evidence-envelope.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE=/^demand:hitpay-candidate:sha256:[0-9a-f]{64}$/;
const ORDER_IDENTITY=/^[0-9a-f]{64}$/;
const fields=[
  "candidateKey","orderIdentityDigest","status","orderId","chargeId","grossMinor","feeMinor",
  "netMinor","refundedMinor","orderPaymentStatus","orderFulfilmentStatus",
  "providerOrderChargeLinkMatched","providerAuthenticationVerified",
  "tenantMembershipVerified","paymentEnvironmentVerified","productVerified",
  "payoutAllocationVerified","bankSettlementVerified","entitlementVerified",
  "acquisitionAttributionVerified","verifiedBrosSellOrders","settledOrders",
  "verifiedCacMinor","causalLift",
] as const;
const falseFlags=[
  "providerAuthenticationVerified","tenantMembershipVerified",
  "paymentEnvironmentVerified","productVerified","payoutAllocationVerified",
  "bankSettlementVerified","entitlementVerified","acquisitionAttributionVerified",
] as const;
const nullFields=["verifiedBrosSellOrders","settledOrders","verifiedCacMinor","causalLift"] as const;
const deny=():never=>{throw new Error("Invalid unattested HitPay handoff");};
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const minor=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;

/** Structural mapping only; serverDerivedScope MUST be authenticated upstream. */
export function projectUnattestedDemandHitPayHandoff(
  input:unknown,
  serverDerivedScope:Readonly<{tenantId:string;product:"demand"}>,
  observedAt:string,
) {
  if(!obj(input)) deny();
  const candidate=input as Record<string,unknown>;
  if(Object.keys(candidate).length!==fields.length||
     Object.keys(candidate).some(key=>!(fields as readonly string[]).includes(key))||
     !obj(serverDerivedScope)||Object.keys(serverDerivedScope).length!==2||
     typeof serverDerivedScope.tenantId!=="string"||!UUID.test(serverDerivedScope.tenantId)||
     serverDerivedScope.product!=="demand"||typeof observedAt!=="string"||
     typeof candidate.candidateKey!=="string"||!CANDIDATE.test(candidate.candidateKey)||
     typeof candidate.orderId!=="string"||!UUID.test(candidate.orderId)||
     typeof candidate.orderIdentityDigest!=="string"||
     !ORDER_IDENTITY.test(candidate.orderIdentityDigest)||
     candidate.orderIdentityDigest!==createHash("sha256")
       .update("bros-demand:hitpay-order-identity:v1:"+candidate.orderId.toLowerCase())
       .digest("hex")||
     typeof candidate.chargeId!=="string"||!UUID.test(candidate.chargeId)||
     !["PROVIDER_REPORTED_PAID","REFUND_OBSERVED","NOT_PAID"].includes(String(candidate.status))||
     !["paid","awaiting_payment","refunded","partially_refunded","canceled"].includes(String(candidate.orderPaymentStatus))||
     !["pending","completed","canceled","payment_in_progress"].includes(String(candidate.orderFulfilmentStatus))||
     candidate.providerOrderChargeLinkMatched!==true||
     falseFlags.some(key=>candidate[key]!==false)||
     nullFields.some(key=>candidate[key]!==null)||
     !minor(candidate.grossMinor)||!minor(candidate.feeMinor)||
     !minor(candidate.netMinor)||!minor(candidate.refundedMinor)||
     candidate.feeMinor+candidate.netMinor!==candidate.grossMinor||
     candidate.refundedMinor>candidate.grossMinor||
     (candidate.status==="PROVIDER_REPORTED_PAID"&&
       (candidate.refundedMinor!==0||candidate.orderPaymentStatus!=="paid"))||
     (candidate.status==="REFUND_OBSERVED"&&candidate.refundedMinor===0&&
       !["refunded","partially_refunded"].includes(String(candidate.orderPaymentStatus)))) deny();

  // Domain-separated source key prevents collisions with other "other" providers.
  // No retrieval time or customer PII enters this stable identifier.
  const providerRecordKey="hitpay:order_charge:sha256:"+createHash("sha256")
    .update(JSON.stringify([candidate.candidateKey,(candidate.orderId as string).toLowerCase(),
      (candidate.chargeId as string).toLowerCase()])).digest("hex");
  const envelope=normalizeEvidenceEnvelope({
    tenantId:serverDerivedScope.tenantId,product:"demand",provider:"other",
    providerRecordKey,observedAt,environment:"unknown",provenance:"synthetic",
    metrics:{
      observed_gross_minor:candidate.grossMinor,observed_fee_minor:candidate.feeMinor,
      observed_net_minor:candidate.netMinor,observed_refunded_minor:candidate.refundedMinor,
      settled_orders:null,verified_bros_sell_orders:null,
      verified_cac_minor:null,causal_lift:null,
    },
  });
  return Object.freeze({
    envelope,sourceProvider:"hitpay" as const,sourceCandidateKey:candidate.candidateKey,
    // Stable pseudonymous identity for cross-revision deduplication; NOT paid-order attestation.
    sourceOrderIdentityDigest:candidate.orderIdentityDigest,
    sourceStatus:candidate.status as "PROVIDER_REPORTED_PAID"|"REFUND_OBSERVED"|"NOT_PAID",
    authenticated:false as const,providerAttested:false as const,
    paymentEnvironmentVerified:false as const,settlementVerified:false as const,
    entitlementVerified:false as const,attributionVerified:false as const,
    persisted:false as const,
  });
}
