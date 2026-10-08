import Link from "next/link";
import {requireBciOperator} from "@/lib/bci/operator-access";
import {CampaignStudio} from "./studio-client";
import "../operator.css";
import "./studio.css";
export const metadata={title:"Campaign Studio | BROS AI Marketing Operator"};
export default async function CampaignStudioPage(){
 await requireBciOperator();
 return <main className="shell operator studio">
  <Link href="/operator" className="back">← Marketing Operator</Link>
  <header className="header compact">
   <div>
    <p className="eyebrow">BROS INTERNAL · CAMPAIGN EXECUTION</p>
    <h1>Campaign Studio</h1>
    <p className="sub">Verified product copy → Meta campaign draft → explicit lifetime budget authorization → staged PAUSED launch → controlled activation → audit.</p>
   </div>
   <span className="operator-mode">FINANCIAL GATE · NO SILENT SPEND</span>
  </header>
  <CampaignStudio/>
 </main>;
}
