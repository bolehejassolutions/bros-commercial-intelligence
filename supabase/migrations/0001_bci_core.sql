-- BROS Commercial Intelligence core relational model.
-- Apply only to the dedicated BCI Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  captured_at timestamptz not null default now(),
  subject text,
  content text not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open',
  significance text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  question text not null,
  status text not null default 'open',
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  observed_facts text not null default '',
  hypotheses text not null default '',
  supporting_evidence text not null default '',
  contradicting_evidence text not null default '',
  uncertainty text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  decision text not null,
  rationale text not null default '',
  assumptions text not null default '',
  decided_at timestamptz not null default now(),
  decision_owner uuid
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'planned',
  due_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.outcomes (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id) on delete cascade,
  result text not null,
  observed_at timestamptz not null default now()
);

create table if not exists public.learnings (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid references public.outcomes(id) on delete set null,
  title text not null,
  learning text not null,
  confidence text,
  created_at timestamptz not null default now()
);

create table if not exists public.case_evidence (
  case_id uuid not null references public.cases(id) on delete cascade,
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  primary key (case_id, evidence_id)
);

create table if not exists public.signal_evidence (
  signal_id uuid not null references public.signals(id) on delete cascade,
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  primary key (signal_id, evidence_id)
);

create table if not exists public.case_signals (
  case_id uuid not null references public.cases(id) on delete cascade,
  signal_id uuid not null references public.signals(id) on delete cascade,
  primary key (case_id, signal_id)
);

create index if not exists cases_status_idx on public.cases(status);
create index if not exists signals_status_idx on public.signals(status);
create index if not exists evidence_captured_at_idx on public.evidence(captured_at desc);
create index if not exists learnings_created_at_idx on public.learnings(created_at desc);

alter table public.evidence enable row level security;
alter table public.signals enable row level security;
alter table public.cases enable row level security;
alter table public.diagnoses enable row level security;
alter table public.decisions enable row level security;
alter table public.actions enable row level security;
alter table public.outcomes enable row level security;
alter table public.learnings enable row level security;
alter table public.case_evidence enable row level security;
alter table public.signal_evidence enable row level security;
alter table public.case_signals enable row level security;

-- Policy creation is intentionally deferred until the dedicated internal
-- authentication model is selected. Do not expose these tables publicly.
