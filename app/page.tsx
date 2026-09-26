import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createCase, logout } from "@/app/actions";

const stages = ["Evidence","Signal","Case","Diagnosis","Decision","Action","Outcome","Learning"];

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: cases } = await supabase.from("cases").select("id,title,question,status,updated_at").order("updated_at", { ascending: false });

  return (
    <main className="shell">
      <header className="header">
        <div><p className="eyebrow">BROS INTERNAL APPLICATION</p><h1>Commercial Intelligence</h1><p className="sub">Evidence → Signal → Case → Diagnosis → Decision → Action → Outcome → Learning.</p></div>
        <div className="header-actions"><span className="badge">INTERNAL</span><form action={logout}><button className="ghost">Sign out</button></form></div>
      </header>
      <section className="loop" aria-label="Intelligence loop">{stages.map((stage, index) => <div className="stage" key={stage}><span>{String(index + 1).padStart(2, "0")}</span><strong>{stage}</strong></div>)}</section>
      <section className="grid">
        <div className="panel wide">
          <div className="panel-head"><div><p className="label">CASE QUEUE</p><h2>Commercial cases</h2></div></div>
          <div className="case-list">{(cases ?? []).map((item: any) => <Link className="case" href={"/cases/" + item.id} key={item.id}><div><span className="status">{item.status}</span><h3>{item.title}</h3><p>{item.question}</p></div><span className="arrow">→</span></Link>)}</div>
          {!cases?.length && <p className="empty">No cases yet. Start with a commercial question worth answering.</p>}
        </div>
        <aside className="panel">
          <p className="label">NEW CASE</p><h2>Start with a question.</h2>
          <form action={createCase} className="form">
            <input name="title" placeholder="Case title" required />
            <textarea name="question" placeholder="What commercial question are we trying to answer?" required />
            <button>Create case</button>
          </form>
        </aside>
      </section>
    </main>
  );
}
