/** DEMAND-only immutable creative intake. Never authorizes Meta writes. */
const deny=()=>{throw Error('DEMAND_CREATIVE_INTAKE_UNVERIFIED')};
const plain=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&'value'in d});
const token=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function prepareDemandCreativeIntake(input,scope){
 try{
  if(!plain(scope,['tenantId','brandInstanceId'])||!token(scope.tenantId)||!token(scope.brandInstanceId))deny();
  if(!plain(input,['tenantId','brandInstanceId','assetId','creativeVersion','media','editorial','logo','hypothesis'])||input.tenantId!==scope.tenantId||input.brandInstanceId!==scope.brandInstanceId||!token(input.assetId)||!token(input.creativeVersion))deny();
  const m=input.media,e=input.editorial,l=input.logo,h=input.hypothesis;
  if(!plain(m,['sha256','mime','bytes','width','height','verifiedAt','qaStatus'])||!sha(m.sha256)||!['image/png','image/jpeg','video/mp4'].includes(m.mime)||!Number.isSafeInteger(m.bytes)||m.bytes<1024||m.bytes>100000000||!Number.isSafeInteger(m.width)||!Number.isSafeInteger(m.height)||m.width<320||m.height<320||m.width>8192||m.height>8192||!stamp(m.verifiedAt)||m.qaStatus!=='PASSED')deny();
  if(!plain(e,['reviewId','reviewedAt','status','disclosureChecked','productTruthChecked'])||!token(e.reviewId)||!stamp(e.reviewedAt)||e.status!=='APPROVED'||e.disclosureChecked!==true||e.productTruthChecked!==true||Date.parse(m.verifiedAt)>Date.parse(e.reviewedAt))deny();
  if(!plain(l,['used','approvedAssetSha256'])||typeof l.used!=='boolean'||(l.used?!sha(l.approvedAssetSha256):l.approvedAssetSha256!==null))deny();
  if(!plain(h,['id','copyLocale','threeSecondCheck','spokenMalayCheck','benefitCheck','claimEvidenceCheck'])||!token(h.id)||h.copyLocale!=='ms-MY'||![h.threeSecondCheck,h.spokenMalayCheck,h.benefitCheck,h.claimEvidenceCheck].every(x=>x===true))deny();
  return Object.freeze({state:'PREPARED_NOT_AUTHORIZED',tenantId:scope.tenantId,brandInstanceId:scope.brandInstanceId,assetId:input.assetId,creativeVersion:input.creativeVersion,mediaSha256:m.sha256,mediaBytes:m.bytes,mediaMime:m.mime,editorialReviewId:e.reviewId,metaWriteAllowed:false,spendApproved:false,providerMediaVerified:false});
 }catch{deny()}
}
