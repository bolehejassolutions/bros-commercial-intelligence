import { createHash } from "node:crypto";

/**
 * BROS CONTENT → DEMAND → SELL internal attribution-link contract.
 *
 * A proposed UTM label is not an authenticated landing receipt, published
 * content, paid order, provider attestation, or approval to modify ads.
 * The caller must obtain tenant membership and approved creative separately.
 * This module performs no network access, persistence or provider mutation.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plan=/^content-plan-[a-f0-9]{64}$/;
const digest=/^[a-f0-9]{64}$/;
const campaign=/^[a-z][a-z0-9_]{2,63}$/;
const channels=new Set(["facebook","instagram","tiktok"]);
const keys=(x,k)=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
  Reflect.ownKeys(x).length===k.length&&k.every(name=>{
    const d=Object.getOwnPropertyDescriptor(x,name);
    return !!d&&d.enumerable&&Object.hasOwn(d,"value");
  })&&Reflect.ownKeys(x).every(name=>typeof name==="string"&&k.includes(name));
const reject=()=>{throw new Error("BROS_PORTFOLIO_LINEAGE_INVALID");};
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const validUrl=x=>{
  if(typeof x!=="string"||x.length<12||x.length>2048)return reject();
  let u;try{u=new URL(x);}catch{return reject();}
  if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.port||
     u.hash||/^(?:localhost|.*\.local|.*\.internal)$/i.test(u.hostname)||
     /^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)||
     /^\[.*\]$/.test(u.hostname))return reject();
  const reserved=["utm_source","utm_medium","utm_campaign","utm_content"];
  if(reserved.some(k=>u.searchParams.has(k)))return reject();
  return u;
};

export function prepareContentDemandLink(input){
  if(!keys(input,["schemaVersion","tenantId","contentPlanId","creativeSha256",
      "channel","campaignKey","landingUrl"])||input.schemaVersion!==1||
     typeof input.tenantId!=="string"||!uuid.test(input.tenantId)||
     typeof input.contentPlanId!=="string"||!plan.test(input.contentPlanId)||
     typeof input.creativeSha256!=="string"||!digest.test(input.creativeSha256)||
     !channels.has(input.channel)||typeof input.campaignKey!=="string"||
     !campaign.test(input.campaignKey))return reject();
  const u=validUrl(input.landingUrl);
  const tenantId=input.tenantId.toLowerCase();
  const key=hash(["bros-content-demand-lineage-v1",tenantId,input.contentPlanId,
                  input.creativeSha256,input.channel,input.campaignKey,u.href]);
  const tracking=Object.freeze({
    utm_source:input.channel,
    utm_medium:"organic_social",
    utm_campaign:input.campaignKey,
    utm_content:"bc_"+key.slice(0,24),
  });
  for(const [name,value] of Object.entries(tracking))u.searchParams.set(name,value);
  return Object.freeze({
    schemaVersion:1,kind:"BROS_CONTENT_DEMAND_LINEAGE_V1",
    tenantId,contentPlanId:input.contentPlanId,creativeSha256:input.creativeSha256,
    channel:input.channel,campaignKey:input.campaignKey,
    lineageKey:"content-demand:"+key,tracking,
    trackedLandingUrl:u.href,
    status:"LINK_SPEC_NOT_PUBLISHED",
    approvalVerified:false,publicationVerified:false,landingReceiptVerified:false,
    checkoutCorrelationVerified:false,paidOrderVerified:false,
    attributedRevenueMYR:null,verifiedPurchases:null,attributionClaimAllowed:false,
    executionAllowed:false,
  });
}

/**
 * A matching URL only establishes syntactic coherence. Inbound records must
 * be verified by the trusted first-party server with consent and evidence
 * before BCI can attest anything. Never use a browser-provided tenant as
 * authorization or infer sales from matching UTM parameters.
 */
export function reviewContentDemandLandingLabels(proposal,landingUrl,serverTenantId){
  if(!keys(proposal,["schemaVersion","kind","tenantId","contentPlanId",
      "creativeSha256","channel","campaignKey","lineageKey","tracking",
      "trackedLandingUrl","status","approvalVerified","publicationVerified",
      "landingReceiptVerified","checkoutCorrelationVerified","paidOrderVerified",
      "attributedRevenueMYR","verifiedPurchases","attributionClaimAllowed",
      "executionAllowed"])||
     typeof serverTenantId!=="string"||!uuid.test(serverTenantId)||
     proposal.tenantId!==serverTenantId.toLowerCase())return reject();
  const expected=prepareContentDemandLink({
    schemaVersion:1,tenantId:proposal.tenantId,contentPlanId:proposal.contentPlanId,
    creativeSha256:proposal.creativeSha256,channel:proposal.channel,
    campaignKey:proposal.campaignKey,
    landingUrl:(()=>{
      const target=new URL(proposal.trackedLandingUrl);
      for(const key of ["utm_source","utm_medium","utm_campaign","utm_content"])target.searchParams.delete(key);
      return target.href;
    })(),
  });
  if(proposal.kind!==expected.kind||proposal.lineageKey!==expected.lineageKey||
     proposal.trackedLandingUrl!==expected.trackedLandingUrl||
     JSON.stringify(proposal.tracking)!==JSON.stringify(expected.tracking)||
     proposal.status!=="LINK_SPEC_NOT_PUBLISHED"||
     [proposal.approvalVerified,proposal.publicationVerified,
       proposal.landingReceiptVerified,proposal.checkoutCorrelationVerified,
       proposal.paidOrderVerified,proposal.attributionClaimAllowed,
       proposal.executionAllowed].some(x=>x!==false)||
     proposal.attributedRevenueMYR!==null||proposal.verifiedPurchases!==null)return reject();
  if(typeof landingUrl!=="string"||landingUrl.length>2048)return reject();
  let observed;try{observed=new URL(landingUrl);}catch{return reject();}
  if(observed.protocol!=="https:"||observed.username||observed.password||
     observed.hash)return reject();
  const tagged=new URL(expected.trackedLandingUrl);
  const fields=["utm_source","utm_medium","utm_campaign","utm_content"];
  const labelsMatch=observed.origin===tagged.origin&&
    observed.pathname===tagged.pathname&&
    fields.every(k=>observed.searchParams.getAll(k).length===1&&
      observed.searchParams.get(k)===tagged.searchParams.get(k))&&
    [...tagged.searchParams.keys()].every(k=>fields.includes(k)||
      observed.searchParams.getAll(k).join("|")===tagged.searchParams.getAll(k).join("|"));
  return Object.freeze({
    lineageKey:expected.lineageKey,
    status:labelsMatch?"MATCHED_LABELS_UNATTESTED":"LABEL_MISMATCH",
    labelsMatch,serverReceiptVerified:false,providerPublicationVerified:false,
    verifiedPaidOrder:null,revenueMYR:null,
    nextAction:labelsMatch?"VERIFY_CONSENTED_SERVER_RECEIPT_AND_CHECKOUT_LINK":
      "REJECT_UNMATCHED_OR_DUPLICATE_UTM_LABELS",
    executionAllowed:false,
  });
}
