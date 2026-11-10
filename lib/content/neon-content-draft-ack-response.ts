/** Fail-closed acknowledgement for DEV draft writes.
 * An HTTP 2xx or malformed JSON is NOT evidence that Neon persisted a draft.
 * The same idempotency key must remain available after an uncertain response.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>
 value!==null&&typeof value==='object'&&!Array.isArray(value);
export class ContentDraftAcknowledgementInvalid extends Error{
 constructor(){super('Pengesahan simpanan draf tidak lengkap. Cuba semula dengan permintaan yang sama.');
  this.name='ContentDraftAcknowledgementInvalid';}
}
export type ContentDraftAcknowledgement=Readonly<{id:string;status:'draft';replayed:boolean}>;
export function parseContentDraftAcknowledgement(
 payload:unknown,httpStatus:number
):ContentDraftAcknowledgement {
 if(httpStatus!==201||!object(payload)||!object(payload.data)||
  !UUID.test(String(payload.data.id??''))||
  payload.data.status!=='draft'||
  ('replayed' in payload.data&&typeof payload.data.replayed!=='boolean'))
  throw new ContentDraftAcknowledgementInvalid();
 return Object.freeze({id:payload.data.id as string,status:'draft',
  replayed:payload.data.replayed===true});
}
