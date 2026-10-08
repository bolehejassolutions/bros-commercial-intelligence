-- End-to-end campaign operator: explicit budget authorizations, audit and staged Meta execution.
-- No secrets stored in public schema, no Meta operations from SQL.
create table public.bci_campaign_plans (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  name text not null check(length(name) between 5 and 140 and name ~* '^BROS\\s*SELL'),
  market text not null default 'MY' check(market='MY'),
  account_id text not null default 'act_1997776120879476' check(account_id='act_1997776120879476'),
  objective text not null default 'TRAFFIC' check(objective in ('TRAFFIC','SALES')),
  primary_text text not null check(length(primary_text) between 40 and 2000),
  headline text not null check(length(headline) between 8 and 255),
  description text not null default '',
  destination_url text not null default 'https://bros.bolehejas.com/' check(destination_url='https://bros.bolehejas.com/'),
  page_id text not null check(page_id ~ '^[0-9]{6,}$'),
  image_hash text not null check(image_hash ~ '^[a-fA-F0-9]{32}$'),
  pixel_id text check(pixel_id is null or pixel_id ~ '^[0-9]{6,}$'),
  duration_days integer not null check(duration_days between 1 and 30),
  budget_cap_myr numeric(12,2) not null default 0 check(budget_cap_myr >= 0),
  authorization_phrase text,
  authorized_at timestamptz,
  authorization_expires_at timestamptz,
  status text not null default 'DRAFT' check(status in
    ('DRAFT','APPROVED','STAGING','STAGED','ACTIVATING','ACTIVE','PAUSING','PAUSED','FAILED')),
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_requires_pixel check (objective != 'SALES' or pixel_id is not null)
);
create index bci_campaign_plans_recent_idx on public.bci_campaign_plans(created_at desc);
alter table public.bci_campaign_plans enable row level security;
revoke all on public.bci_campaign_plans from anon,authenticated;
grant select on public.bci_campaign_plans to authenticated;
grant insert (created_by,name,objective,primary_text,headline,description,page_id,image_hash,pixel_id,duration_days)
  on public.bci_campaign_plans to authenticated;
create policy bci_plans_read on public.bci_campaign_plans
 for select to authenticated using ((select public.is_bci_operator()));
create policy bci_plans_insert on public.bci_campaign_plans
 for insert to authenticated with check (
  (select public.is_bci_operator()) and created_by=(select auth.uid())
  and status='DRAFT' and budget_cap_myr=0 and meta_campaign_id is null
 );

create table public.bci_campaign_audit (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.bci_campaign_plans(id) on delete restrict,
 actor_id uuid references auth.users(id),
 event text not null,
 details jsonb not null default '{}'::jsonb,
 recorded_at timestamptz not null default now()
);
create index bci_campaign_audit_latest_idx on public.bci_campaign_audit(plan_id,recorded_at desc);
alter table public.bci_campaign_audit enable row level security;
revoke all on public.bci_campaign_audit from anon,authenticated;
grant select on public.bci_campaign_audit to authenticated;
create policy bci_campaign_audit_read on public.bci_campaign_audit
 for select to authenticated using ((select public.is_bci_operator()));

create or replace function public.is_bci_admin()
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.bci_operator_members
 where user_id=(select auth.uid()) and role='admin' and active=true)
$$;
revoke all on function public.is_bci_admin() from public,anon;
grant execute on function public.is_bci_admin() to authenticated;

-- Approving a plan records an EXACT finite lifetime budget and a short execution window.
-- Authorization applies only to one verified plan, no global authority.
create or replace function public.bci_approve_plan(p_id uuid,p_cap numeric,p_phrase text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare p public.bci_campaign_plans%rowtype;
  required_phrase text;
begin
 if not public.is_bci_admin() then raise exception 'Administrator permission required'; end if;
 select * into p from public.bci_campaign_plans where id=p_id for update;
 if not found or p.status!='DRAFT' then raise exception 'Plan is not an editable draft'; end if;
 if p_cap is null or p_cap < 5 or p_cap > 10000 or p_cap != round(p_cap,2) then
   raise exception 'Budget cap must be RM5 to RM10000, with 2 decimal places';
 end if;
 required_phrase := 'AUTHORIZE RM' || to_char(p_cap,'FM9999990.00');
 if p_phrase is distinct from required_phrase then
   raise exception 'Authorization phrase mismatch. Enter exact approval and budget.';
 end if;
 update public.bci_campaign_plans
  set status='APPROVED',budget_cap_myr=p_cap,authorization_phrase=required_phrase,
      authorized_at=now(), authorization_expires_at=now()+interval '24 hours',
      updated_at=now()
  where id=p_id;
 insert into public.bci_campaign_audit(plan_id,actor_id,event,details)
  values(p_id,auth.uid(),'EXPLICIT_BUDGET_APPROVAL',
   jsonb_build_object('cap_myr',p_cap,'expires_in_hours',24,'campaign_name',p.name));
 return jsonb_build_object('id',p_id,'status','APPROVED','cap_myr',p_cap);
end $$;

-- Claim one transition atomically BEFORE external request; no duplicate requests on retry.
create or replace function public.bci_claim_plan(p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare p public.bci_campaign_plans%rowtype; new_status text;
begin
 if not public.is_bci_admin() then raise exception 'Administrator permission required'; end if;
 select * into p from public.bci_campaign_plans where id=p_id for update;
 if not found then raise exception 'Plan not found'; end if;
 if p.authorization_expires_at is null or p.authorization_expires_at <= now()
   then raise exception 'Budget approval expired; create a fresh plan'; end if;
 if p_action='STAGE' and p.status='APPROVED' and p.meta_campaign_id is null then
   new_status:='STAGING';
 elsif p_action='ACTIVATE' and p.status='STAGED' and
   p.meta_campaign_id is not null and p.meta_adset_id is not null and
   p.meta_creative_id is not null and p.meta_ad_id is not null then
   new_status:='ACTIVATING';
 elsif p_action='PAUSE' and p.status='ACTIVE' then
   new_status:='PAUSING';
 else raise exception 'Disallowed state transition'; end if;
 update public.bci_campaign_plans set status=new_status,updated_at=now() where id=p_id;
 insert into public.bci_campaign_audit(plan_id,actor_id,event,details)
 values(p_id,auth.uid(),'CLAIM_'||p_action,jsonb_build_object('from',p.status,'to',new_status));
 return to_jsonb(p);
end $$;

create or replace function public.bci_record_stage_id(p_id uuid,p_step text,p_meta_id text)
returns void language plpgsql security definer set search_path=''
as $$
declare col text; old_id text;
begin
 if not public.is_bci_admin() then raise exception 'Administrator permission required'; end if;
 if p_meta_id !~ '^[0-9]{6,}$' then raise exception 'Invalid provider ID'; end if;
 col:=case p_step when 'campaign' then 'meta_campaign_id'
  when 'adset' then 'meta_adset_id' when 'creative' then 'meta_creative_id'
  when 'ad' then 'meta_ad_id' else null end;
 if col is null then raise exception 'Unknown staged object'; end if;
 execute format('select %I from public.bci_campaign_plans where id=$1 and status=$2 for update',col)
 into old_id using p_id,'STAGING';
 if not found then raise exception 'Plan not being staged'; end if;
 if old_id is not null then raise exception 'Provider ID already stored; no retries'; end if;
 execute format('update public.bci_campaign_plans set %I=$2,updated_at=now() where id=$1',col)
 using p_id,p_meta_id;
 insert into public.bci_campaign_audit(plan_id,actor_id,event,details)
 values(p_id,auth.uid(),'STAGED_'||upper(p_step),jsonb_build_object('meta_id',p_meta_id));
end $$;

create or replace function public.bci_complete_plan(p_id uuid,p_state text,p_error text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare current_state text; next_state text;
begin
 if not public.is_bci_admin() then raise exception 'Administrator permission required'; end if;
 select status into current_state from public.bci_campaign_plans where id=p_id for update;
 next_state:=case when current_state='STAGING' and p_state='SUCCESS' then 'STAGED'
   when current_state='ACTIVATING' and p_state='SUCCESS' then 'ACTIVE'
   when current_state='PAUSING' and p_state='SUCCESS' then 'PAUSED'
   when current_state in ('STAGING','ACTIVATING','PAUSING') and p_state='FAILED' then 'FAILED'
   else null end;
 if next_state is null then raise exception 'Invalid completion transition'; end if;
 if next_state='STAGED' and exists(
  select 1 from public.bci_campaign_plans where id=p_id
  and (meta_campaign_id is null or meta_adset_id is null or meta_creative_id is null or meta_ad_id is null))
 then raise exception 'All four staged objects are required'; end if;
 update public.bci_campaign_plans set status=next_state,last_error=left(p_error,500),updated_at=now() where id=p_id;
 insert into public.bci_campaign_audit(plan_id,actor_id,event,details)
 values(p_id,auth.uid(),next_state,jsonb_build_object('error',left(coalesce(p_error,''),500)));
end $$;

revoke all on function public.bci_approve_plan(uuid,numeric,text) from public,anon;
revoke all on function public.bci_claim_plan(uuid,text) from public,anon;
revoke all on function public.bci_record_stage_id(uuid,text,text) from public,anon;
revoke all on function public.bci_complete_plan(uuid,text,text) from public,anon;
grant execute on function public.bci_approve_plan(uuid,numeric,text) to authenticated;
grant execute on function public.bci_claim_plan(uuid,text) to authenticated;
grant execute on function public.bci_record_stage_id(uuid,text,text) to authenticated;
grant execute on function public.bci_complete_plan(uuid,text,text) to authenticated;
