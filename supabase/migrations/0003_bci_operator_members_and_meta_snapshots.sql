-- BROS Commercial Intelligence: membership ACL + read-only Meta observation store.
-- Dedicated BCI database ONLY. Install after 0001_bci_core.sql.
-- Do NOT apply legacy 0002_lock_down_bci_access.sql to new environments:
-- it contains a historic user UUID from an unrelated bootstrap.
create table if not exists public.bci_operator_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('operator','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.bci_operator_members enable row level security;
revoke all on public.bci_operator_members from anon, authenticated;
-- Only postgres/dashboard admins provision verified operators.
-- Never create an enrollment endpoint exposed to the browser.

create or replace function public.is_bci_operator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bci_operator_members
    where user_id = (select auth.uid()) and active = true
  )
$$;
revoke all on function public.is_bci_operator() from public, anon;
grant execute on function public.is_bci_operator() to authenticated;

do $$
declare tab text;
begin
  foreach tab in array array[
    'evidence','signals','cases','diagnoses','decisions','actions','outcomes','learnings',
    'case_evidence','signal_evidence','case_signals'
  ] loop
    execute format('drop policy if exists bci_internal_access on public.%I', tab);
    execute format('drop policy if exists bci_verified_operator on public.%I', tab);
    execute format('create policy bci_verified_operator on public.%I for all to authenticated using ((select public.is_bci_operator())) with check ((select public.is_bci_operator()))', tab);
    execute format('revoke all on public.%I from anon', tab);
    execute format('grant select,insert,update,delete on public.%I to authenticated',tab);
  end loop;
end $$;

create table if not exists public.marketing_meta_snapshots (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'MY' check(market = 'MY'),
  account_id text not null check(account_id ~ '^act_[0-9]{6,}$'),
  campaign_id text not null check(campaign_id ~ '^[0-9]{6,}$'),
  campaign_name text not null,
  period_start date not null,
  period_end date not null,
  spend_myr numeric(16,2) not null check(spend_myr >= 0),
  impressions bigint not null check(impressions >= 0),
  link_clicks bigint not null check(link_clicks >= 0),
  landing_page_views bigint check(landing_page_views is null or landing_page_views >= 0),
  purchases bigint check(purchases is null or purchases >= 0),
  attributed_revenue_myr numeric(16,2) check(attributed_revenue_myr is null or attributed_revenue_myr >= 0),
  source_reference text not null,
  fetched_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  constraint marketing_meta_snapshots_unique unique(account_id,campaign_id,period_start,period_end),
  constraint marketing_meta_snapshots_valid_window check(period_start <= period_end)
);
create index if not exists marketing_meta_snapshots_recent_idx on public.marketing_meta_snapshots(fetched_at desc);
alter table public.marketing_meta_snapshots enable row level security;
revoke all on public.marketing_meta_snapshots from anon,authenticated;
grant select,insert,update on public.marketing_meta_snapshots to authenticated;
drop policy if exists bci_meta_snapshot_select on public.marketing_meta_snapshots;
create policy bci_meta_snapshot_select on public.marketing_meta_snapshots for select to authenticated
  using ((select public.is_bci_operator()));
drop policy if exists bci_meta_snapshot_insert on public.marketing_meta_snapshots;
create policy bci_meta_snapshot_insert on public.marketing_meta_snapshots for insert to authenticated
  with check ((select public.is_bci_operator()) and created_by = (select auth.uid()));
drop policy if exists bci_meta_snapshot_update on public.marketing_meta_snapshots;
create policy bci_meta_snapshot_update on public.marketing_meta_snapshots for update to authenticated
  using ((select public.is_bci_operator())) with check ((select public.is_bci_operator()) and created_by = (select auth.uid()));
