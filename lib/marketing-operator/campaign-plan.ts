/**
 * Canonical product facts only. Never invent endorsements, results or scarcity.
 * Commercial offer is RM100 until changed at its authoritative source.
 */
export const BROS_SELL_PRODUCT = Object.freeze({
 name:"BROS SELL™ — Closing OS",
 market:"MY",
 destination:"https://bros.bolehejas.com/",
 offerMYR:100,
 doctrine:"Menjelaskan, bukan Memujuk.",
 facts:[
  "Practical Sales Operating System for Malaysian sellers and business owners.",
  "Core book: 36 chapters, 104 pages (v2.5 inside customer package v2.6).",
  "12 Visual System Maps and 13 XLSX toolkits/workbooks.",
  "One-time product price RM100 until further notice.",
 ],
 prohibited:[
  "Guaranteed revenue, closing percentages or ROI.",
  "Testimonials or customer results not in verified sources.",
  "False urgency, price discounts or invented bonuses.",
  "Recreated logos or generated unofficial brand assets.",
 ],
});
export interface CreativeDraft {
 headline:string;
 primaryText:string;
 description:string;
 source:"verified-template" | "gemini-assisted";
}
export function safeDefaultDraft():CreativeDraft {
 return {
  headline:"BROS SELL™ — Sistem Jualan Lebih Tersusun",
  primaryText:"Pelanggan bertanya, tetapi keputusan masih tertangguh? Jualan perlukan proses yang jelas — kenali pembeli, jelaskan nilai tawaran dan lakukan susulan dengan sistem. BROS SELL™ — Closing OS merangkumi buku 36 bab, 12 peta sistem visual dan 13 toolkit XLSX. Harga RM100. Menjelaskan, bukan Memujuk.",
  description:"Lihat kandungan BROS SELL™ — Closing OS sebelum membuat keputusan.",
  source:"verified-template",
 };
}
export function validateCreative(input: {headline:unknown;primaryText:unknown;description?:unknown}) {
 const headline=typeof input.headline==="string"?input.headline.trim():"";
 const primaryText=typeof input.primaryText==="string"?input.primaryText.trim():"";
 const description=typeof input.description==="string"?input.description.trim():"";
 if(headline.length<8||headline.length>255||primaryText.length<40||primaryText.length>2000||description.length>500){
  throw new Error("Ad copy length is invalid.");
 }
 if(/[\u0000-\u001f]/.test(headline+primaryText+description))throw new Error("Control characters are not allowed.");
 if(/(guarantee|guaranteed|jamin untung|pasti kaya|100% closing|confirm kaya)/i.test(primaryText+" "+headline))throw new Error("Prohibited unverified outcome claim.");
 return {headline,primaryText,description};
}
export async function generateOptionalGeminiDraft(userAngle:string,fetcher:typeof fetch=fetch):Promise<CreativeDraft> {
 const angle=userAngle.slice(0,260).trim();
 const baseline=safeDefaultDraft();
 const apiKey=process.env.GEMINI_API_KEY;
 if(!apiKey) return baseline;
 const model="gemini-2.5-flash";
 const system=[...BROS_SELL_PRODUCT.facts, ...BROS_SELL_PRODUCT.prohibited.map(x=>"DO NOT CLAIM: "+x)].join("\n");
 const response=await fetcher("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
  method:"POST",
  headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},
  body:JSON.stringify({contents:[{parts:[{text:
    "Write Malay-only BROS SELL™ Facebook/Instagram ad copy. Angle: "+angle+
    "\nVerified product facts and constraints:\n"+system+
    "\nRespond in STRICT JSON: {\"headline\":\"...\",\"primaryText\":\"...\",\"description\":\"...\"}"+
    "\nDo not fabricate benefits, price reductions or claims. No testimonials. No markdown."}]}],
    generationConfig:{temperature:0.4,responseMimeType:"application/json",maxOutputTokens:450}}),
  cache:"no-store",signal:AbortSignal.timeout(18000)
 });
 if(!response.ok) throw new Error("Gemini draft provider unavailable; use verified template instead.");
 const result=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
 const raw=result.candidates?.[0]?.content?.parts?.[0]?.text;
 if(!raw)throw new Error("Gemini returned no draft text.");
 const copy=JSON.parse(raw) as {headline:unknown;primaryText:unknown;description:unknown};
 return {...validateCreative(copy),source:"gemini-assisted"};
}
