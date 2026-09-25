const stages = [
  "Evidence",
  "Signal",
  "Case",
  "Diagnosis",
  "Decision",
  "Action",
  "Outcome",
  "Learning"
];

const cases = [
  { title: "Early Bird acquisition", status: "Active", signal: "Conversion evidence needs review." },
  { title: "BROS SELL customer feedback", status: "Open", signal: "Initial customer learning pending." },
  { title: "Content → purchase path", status: "Open", signal: "Need evidence before changing funnel." }
];

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">BROS INTERNAL APPLICATION</p>
          <h1>Commercial Intelligence</h1>
          <p className="sub">Turn commercial evidence into decisions, actions and learning.</p>
        </div>
        <span className="badge">INTERNAL</span>
      </header>

      <section className="loop" aria-label="Intelligence loop">
        {stages.map((stage, index) => (
          <div className="stage" key={stage}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage}</strong>
          </div>
        ))}
      </section>

      <section className="grid">
        <div className="panel wide">
          <div className="panel-head">
            <div>
              <p className="label">CASE WORKSPACE</p>
              <h2>Active commercial cases</h2>
            </div>
            <button type="button">New case</button>
          </div>
          <div className="case-list">
            {cases.map((item) => (
              <article className="case" key={item.title}>
                <div>
                  <span className="status">{item.status}</span>
                  <h3>{item.title}</h3>
                  <p>{item.signal}</p>
                </div>
                <span className="arrow">→</span>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel">
          <p className="label">OPERATING PRINCIPLE</p>
          <h2>Decision clarity over dashboard volume.</h2>
          <p className="muted">
            BCI separates observed evidence, inference, decisions and outcomes so
            commercial learning remains traceable.
          </p>
        </aside>
      </section>
    </main>
  );
}
