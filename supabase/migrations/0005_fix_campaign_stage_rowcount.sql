-- Fix the stage ID persistence function's dynamic-SQL row count.
-- PL/pgSQL EXECUTE does not update FOUND; ROW_COUNT must be used.
create or replace function public.bci_record_stage_id(p_id uuid,p_step text,p_meta_id text)
returns void language plpgsql security definer set search_path=''
as $$
declare col text; old_id text; selected_rows integer;
begin
 if not public.is_bci_admin() then raise exception 'Administrator permission required'; end if;
 if p_meta_id !~ '^[0-9]{6,}$' then raise exception 'Invalid provider ID'; end if;
 col:=case p_step when 'campaign' then 'meta_campaign_id'
  when 'adset' then 'meta_adset_id' when 'creative' then 'meta_creative_id'
  when 'ad' then 'meta_ad_id' else null end;
 if col is null then raise exception 'Unknown staged object'; end if;
 execute format('select %I from public.bci_campaign_plans where id=$1 and status=$2 for update',col)
 into old_id using p_id,'STAGING';
 get diagnostics selected_rows = ROW_COUNT;
 if selected_rows != 1 then raise exception 'Plan not being staged'; end if;
 if old_id is not null then raise exception 'Provider ID already stored; no retries'; end if;
 execute format('update public.bci_campaign_plans set %I=$2,updated_at=now() where id=$1',col)
 using p_id,p_meta_id;
 insert into public.bci_campaign_audit(plan_id,actor_id,event,details)
 values(p_id,auth.uid(),'STAGED_'||upper(p_step),jsonb_build_object('meta_id',p_meta_id));
end $$;
revoke all on function public.bci_record_stage_id(uuid,text,text) from public,anon;
grant execute on function public.bci_record_stage_id(uuid,text,text) to authenticated;
