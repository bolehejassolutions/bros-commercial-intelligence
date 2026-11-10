/** Fail-closed acknowledgement for DEV draft writes.
 * An HTTP 2xx or malformed JSON is NOT evidence that Neon persisted a draft.
 * The same idempotency key must remain available after an uncertain response.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>
 value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Read only own value properties: inherited fields and accessor getters cannot certify a write. */
const ownValue=(value:object,key:string):unknown=>{
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 return descriptor&&'value' in descriptor?descriptor.value:undefined;
};
export class ContentDraftAcknowledgementInvalid extends Error{
 constructor(){super('Pengesahan simpanan draf tidak lengkap. Cuba semula dengan permintaan yang sama.');
  this.name='ContentDraftAcknowledgementInvalid';}
}
export type ContentDraftAcknowledgement=Readonly<{id:string;status:'draft';replayed:boolean}>;
export function parseContentDraftAcknowledgement(
 payload:unknown,httpStatus:number
):ContentDraftAcknowledgement {
 const data=object(payload)?ownValue(payload,'data'):undefined;
 const id=object(data)?ownValue(data,'id'):undefined;
 const status=object(data)?ownValue(data,'status'):undefined;
 const replayed=object(data)?ownValue(data,'replayed'):undefined;
 if(httpStatus!==201||!object(data)||typeof id!=='string'||!UUID.test(id)||
  status!=='draft'||(Object.hasOwn(data,'replayed')&&typeof replayed!=='boolean'))
  throw new ContentDraftAcknowledgementInvalid();
 return Object.freeze({id,status:'draft',replayed:replayed===true});
}
