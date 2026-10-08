import "server-only";
import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";

export const NO_STORE={"Cache-Control":"no-store, private"};
export function forbidden(message="BCI administrator session required.",status=403){
 return NextResponse.json({error:message},{status,headers:NO_STORE});
}
export function validOrigin(req:NextRequest) {
 const origin=req.headers.get("origin");
 return Boolean(origin&&origin===new URL(req.url).origin);
}
export async function adminSession(){
 const supabase=await createClient();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user) return null;
 const {data:allowed,error:accessError}=await supabase.rpc("is_bci_admin");
 return !accessError&&allowed===true?{supabase,user}:null;
}
