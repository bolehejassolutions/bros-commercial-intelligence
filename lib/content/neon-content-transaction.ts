/** Restricted CONTENT-only PostgreSQL transaction adapter.
 * The caller must provide a pool connected DIRECTLY as the restricted CONTENT
 * login, never a database owner or inherited/admin role.
 * No role creation, secrets, routes or grants are performed here.
 */
type QueryResult={rows:readonly Record<string,unknown>[]};
type Client={
 query:(sql:string,params?:readonly unknown[])=>Promise<QueryResult>;
 release:()=>void;
};
type Pool={connect:()=>Promise<Client>};
type Query=(sql:string,params:readonly unknown[])=>Promise<QueryResult>;
export function createContentTransaction(pool:Pool){
 if(!pool||typeof pool.connect!=='function')throw new Error('Missing restricted CONTENT pool');
 return async function transaction<T>(operation:(query:Query)=>Promise<T>):Promise<T>{
  if(typeof operation!=='function')throw new Error('Missing CONTENT operation');
  const client=await pool.connect();
  let began=false;
  try{
   await client.query('BEGIN');
   began=true;
   // Explicitly reject an inherited non-transaction-local identity from a
   // reused connection. The adapters set their own verified principal with
   // set_config(..., true) before reading any membership.
   await client.query("SELECT set_config('bci.principal_id','',true)");
   const result=await operation((sql,params)=>client.query(sql,params));
   await client.query('COMMIT');
   began=false;
   return result;
  }catch(error){
   if(began){
    try{await client.query('ROLLBACK');}catch{/* preserve original failure */}
   }
   throw error;
  }finally{
   client.release();
  }
 };
}
