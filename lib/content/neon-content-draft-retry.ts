/**
 * Browser-only draft retry identity. An uncertain network response must NOT
 * generate a second campaign when the user retries the same submitted draft.
 * Never persist draft payloads/keys in localStorage, cookies or query strings.
 */
export type ContentDraftAttempt=Readonly<{requestSignature:string;key:string}>;
const KEY=/^[A-Za-z0-9_-]{12,180}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function prepareContentDraftRetry(
 previous:ContentDraftAttempt|null,workspaceId:string,draft:unknown,
 createKey:()=>string
):ContentDraftAttempt {
 if(!UUID.test(workspaceId)||!draft||typeof draft!=='object'||Array.isArray(draft)||
    typeof createKey!=='function')throw new Error('Invalid draft retry state');
 // JSONB draft persistence is insensitive to object property insertion order.
 // Preserve retry identity when the UI reconstructs the same brief in a new order.
 // Keep arrays ordered: platform order is part of the submitted draft.
 let payload:string;
 try {
  // JSONB ignores property insertion order at every object depth, not just root.
  // Arrays remain ordered. Reject cycles and non-JSON values before key issuance.
  const seen=new WeakSet<object>();
  const canonicalize=(value:unknown):unknown=>{
   if(value===null||typeof value==='string'||typeof value==='boolean')return value;
   if(typeof value==='number'&&Number.isFinite(value))return value;
   if(!value||typeof value!=='object')throw new Error('Invalid JSON draft value');
   if(seen.has(value))throw new Error('Cyclic draft value');
   seen.add(value);
   try {
    if(Array.isArray(value)){
     if(Object.getPrototypeOf(value)!==Array.prototype)throw new Error('Invalid draft array');
     const descriptors=Object.getOwnPropertyDescriptors(value);
     // JSON.stringify ignores extra array keys and symbols; reject them rather than
     // allowing distinct caller objects to share one retry identity.
     if(Reflect.ownKeys(value).some(k=>typeof k!=='string'||(k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=value.length))))
      throw new Error('Invalid draft array property');
     for(let i=0;i<value.length;i++){
      const field=descriptors[String(i)];
      if(!field||!('value' in field))throw new Error('Invalid draft array element');
     }
     return Array.from({length:value.length},(_,i)=>canonicalize(descriptors[String(i)].value));
    }
    if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
     throw new Error('Invalid draft object');
    // Inspect descriptors without invoking user-defined getters during retry identity.
    if(Object.getOwnPropertySymbols(value).length)throw new Error('Invalid draft symbol property');
    const descriptors=Object.getOwnPropertyDescriptors(value);
    // JSONB cannot preserve non-enumerable own properties. Reject hidden values
    // instead of assigning an identical retry key to semantically distinct inputs.
    if(Reflect.ownKeys(value).some(k=>typeof k!=='string'||!descriptors[k].enumerable))
     throw new Error('Invalid draft hidden property');
    return Object.fromEntries(Object.keys(descriptors).sort().map(k=>{
     const field=descriptors[k];
     if(!('value' in field))throw new Error('Invalid draft accessor');
     return [k,canonicalize(field.value)];
    }));
   } finally {seen.delete(value);}
  };
  payload=JSON.stringify(canonicalize(draft));
 } catch { throw new Error('Invalid draft payload'); }
 if(!payload||payload.length>18000)throw new Error('Invalid draft payload');
 const requestSignature=workspaceId+'\u0000'+payload;
 if(previous?.requestSignature===requestSignature&&KEY.test(previous.key))return previous;
 const key=createKey();
 if(!KEY.test(key))throw new Error('Invalid draft retry key');
 return Object.freeze({requestSignature,key});
}

/** Only the workspace that initiated a save may display its result. */
export function isContentDraftSaveFeedbackCurrent(submittedWorkspace:string,currentWorkspace:string):boolean {
 return UUID.test(submittedWorkspace)&&submittedWorkspace===currentWorkspace;
}

/** Only the exact in-flight attempt may clear the pending retry identity.
 * A later attempt must survive an older POST acknowledgement.
 */
export function shouldClearContentDraftAttempt(
 pending:ContentDraftAttempt|null,completed:ContentDraftAttempt
):boolean {
 return pending===completed;
}
