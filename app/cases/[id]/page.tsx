import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createEvidence, createSignal, createDiagnosis, createDecision,
  createAction, createOutcome, createLearning
} from "@/app/actions";

type Props = { params: Promise<{ id: string }> };

export default async function CaseWorkspace({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: currentCase } = await supabase.from("cases").select("*").eq("id", id).single();
  if (!currentCase) notFound();

  const [{ data: caseEvidence }, { data: caseSignals }, { data: diagnoses }, { data: decisions }] = await Promise.all([
    supabase.from("case_evidence").select("evidence:evidence_id(*)").eq("case_id", id),
    supabase.from("case_signals").select("signal:signal_id(*)").eq("case_id", id),
    supabase.from("diagnoses").select("*").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.from("decisions").select("*").eq("case_id", id).order("decided_at", { ascending: false })
  ]);

  const decisionIds = (decisions ?? []).map((d: any) => d.id);
  const { data: actions } = decisionIds.length
    ? await supabase.from("actions").select("*").in("decision_id", decisionIds).order("due_at")
    : { data: [] as any[] };
  const actionIds = (actions ?? []).map((a: any) => a.id);
  const { data: outcomes } = actionIds.length
    ? await supabase.from("outcomes").select("*").in("action_id", actionIds).order("observed_at", { ascending: false })
    : { data: [] as any[] };
  const outcomeIds = (outcomes ?? []).map((o: any) => o.id);
  const { data: learnings } = outcomeIds.length
    ? await supabase.from("learnings").select("*").in("outcome_id", outcomeIds).order("created_at", { ascending: false })
    : { data: [] as any[] };

  const evidence = (caseEvidence ?? []).map((x: any) => x.evidence).filter(Boolean);
  const signals = (caseSignals ?? []).map((x: any) => x.signal).filter(Boolean);

  return (
    <main className="shell">
      <header className="header compact">
        <div>
          <Link className="back" href="/">← Intelligence queue</Link>
          <p className="eyebrow">CASE WORKSPACE</p>
          <h1>{currentCase.title}</h1>
          <p className="sub"><strong>Question:</strong> {currentCase.question}</p>
        </div>
        <span className="badge">{currentCase.status.toUpperCase()}</span>
      </header>

      <div className="workflow">
        <Stage n="01" title="Evidence" note="Observed inputs with provenance">
          <div className="records">{evidence.map((e: any) => <Record key={e.id} title={e.subject || e.source} body={e.content} meta={e.source} />)}</div>
          <form action={createEvidence} className="form">
            <input type="hidden" name="case_id" value={id} />
            <div className="row"><input name="source" placeholder="Source (e.g. WhatsApp, HitPay)" required /><input name="subject" placeholder="Subject" /></div>
            <textarea name="content" placeholder="What was actually observed?" required />
            <button>Add evidence</button>
          </form>
        </Stage>

        <Stage n="02" title="Signal" note="What the evidence appears to indicate">
          <div className="records">{signals.map((s: any) => <Record key={s.id} title={s.title} body={s.description || "No description"} meta={s.significance || "Significance not recorded"} />)}</div>
          <form action={createSignal} className="form">
            <input type="hidden" name="case_id" value={id} />
            <input name="title" placeholder="Signal title" required />
            <textarea name="description" placeholder="What pattern or signal is emerging?" />
            <input name="significance" placeholder="Why does this matter?" />
            <button>Add signal</button>
          </form>
        </Stage>

        <Stage n="03" title="Diagnosis" note="Separate facts, hypotheses and uncertainty">
          <div className="records">{(diagnoses ?? []).map((d: any) => <Record key={d.id} title="Diagnosis" body={d.hypotheses || "No hypothesis recorded"} meta={"Facts: " + (d.observed_facts || "—") + " · Uncertainty: " + (d.uncertainty || "—")} />)}</div>
          <form action={createDiagnosis} className="form">
            <input type="hidden" name="case_id" value={id} />
            <textarea name="observed_facts" placeholder="Observed facts" required />
            <textarea name="hypotheses" placeholder="Hypotheses / possible explanations" required />
            <textarea name="supporting_evidence" placeholder="Evidence supporting the hypothesis" />
            <textarea name="contradicting_evidence" placeholder="Evidence contradicting the hypothesis" />
            <textarea name="uncertainty" placeholder="What remains uncertain?" />
            <button>Record diagnosis</button>
          </form>
        </Stage>

        <Stage n="04" title="Decision" note="What will be done and why">
          <div className="records">{(decisions ?? []).map((d: any) => <Record key={d.id} title={d.decision} body={d.rationale || "No rationale recorded"} meta={"Assumptions: " + (d.assumptions || "—")} />)}</div>
          <form action={createDecision} className="form">
            <input type="hidden" name="case_id" value={id} />
            <input name="decision" placeholder="Decision" required />
            <textarea name="rationale" placeholder="Why this decision?" required />
            <textarea name="assumptions" placeholder="What assumptions does it depend on?" />
            <button>Record decision</button>
          </form>
        </Stage>

        <Stage n="05" title="Action" note="Translate the decision into an executable step">
          <div className="records">{(actions ?? []).map((a: any) => <Record key={a.id} title={a.title} body={a.description || "No description"} meta={a.status + (a.due_at ? " · Due " + new Date(a.due_at).toLocaleDateString() : "")} />)}</div>
          <form action={createAction} className="form">
            <input type="hidden" name="case_id" value={id} />
            <label>Decision<select name="decision_id" required><option value="">Select decision</option>{(decisions ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.decision}</option>)}</select></label>
            <input name="title" placeholder="Action" required />
            <textarea name="description" placeholder="What exactly will be done?" />
            <input name="due_at" type="datetime-local" />
            <button>Create action</button>
          </form>
        </Stage>

        <Stage n="06" title="Outcome" note="What actually happened after the action">
          <div className="records">{(outcomes ?? []).map((o: any) => <Record key={o.id} title="Outcome" body={o.result} meta={new Date(o.observed_at).toLocaleString()} />)}</div>
          <form action={createOutcome} className="form">
            <input type="hidden" name="case_id" value={id} />
            <label>Action<select name="action_id" required><option value="">Select action</option>{(actions ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
            <textarea name="result" placeholder="What happened? Record the observed result." required />
            <button>Record outcome</button>
          </form>
        </Stage>

        <Stage n="07" title="Learning" note="Reusable knowledge extracted from outcomes">
          <div className="records">{(learnings ?? []).map((l: any) => <Record key={l.id} title={l.title} body={l.learning} meta={l.confidence || "Confidence not recorded"} />)}</div>
          <form action={createLearning} className="form">
            <input type="hidden" name="case_id" value={id} />
            <label>Outcome<select name="outcome_id"><option value="">Optional outcome</option>{(outcomes ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.result.slice(0, 70)}</option>)}</select></label>
            <input name="title" placeholder="Learning title" required />
            <textarea name="learning" placeholder="What should BROS remember and reuse?" required />
            <input name="confidence" placeholder="Confidence (e.g. high, medium, low)" />
            <button>Capture learning</button>
          </form>
        </Stage>
      </div>
    </main>
  );
}

function Stage({ n, title, note, children }: { n: string; title: string; note: string; children: React.ReactNode }) {
  return <section className="stage-panel"><div className="stage-title"><span>{n}</span><div><p className="label">{title}</p><p className="stage-note">{note}</p></div></div>{children}</section>;
}
function Record({ title, body, meta }: { title: string; body: string; meta: string }) {
  return <article className="record"><strong>{title}</strong><p>{body}</p><small>{meta}</small></article>;
}
