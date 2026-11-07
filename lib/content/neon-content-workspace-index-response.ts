/** Strict, display-only validation of authenticated workspace index responses.
 * A malformed 200 must never be presented as a genuine empty workspace.
 */
export type ContentWorkspaceSummary=Readonly<{id:string;name:string;updated_at?:string}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>
 v!==null&&typeof v==='object'&&!Array.isArray(v);
export class ContentWorkspaceIndexInvalid extends Error {
 constructor(){super('Respons senarai workspace tidak lengkap. Cuba semula.');this.name='ContentWorkspaceIndexInvalid';}
}
export function parseContentWorkspaceIndex(payload:unknown):ContentWorkspaceSummary[]{
 if(!object(payload)||!object(payload.data)||!Array.isArray(payload.data.workspaces)||
    payload.data.workspaces.length>1000)throw new ContentWorkspaceIndexInvalid();
 const ids=new Set<string>();
 return payload.data.workspaces.map((row:unknown)=>{
  if(!object(row)||typeof row.id!=='string'||!UUID.test(row.id)||
     typeof row.name!=='string'||!row.name.trim()||row.name.length>200||
     ids.has(row.id)||('updated_at' in row&&row.updated_at!==null&&
      (typeof row.updated_at!=='string'||row.updated_at.length>100)))
   throw new ContentWorkspaceIndexInvalid();
  ids.add(row.id);
  return {id:row.id,name:row.name,...(typeof row.updated_at==='string'?{updated_at:row.updated_at}:{})};
 });
}
