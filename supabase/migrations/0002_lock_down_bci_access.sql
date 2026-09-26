-- BCI initial internal authorization boundary.
-- Applied to the dedicated BCI Supabase project after the internal user was created.
-- Authorization is bound to auth.uid(), not user-editable metadata.

DO $$
DECLARE
  target_user uuid := 'c26ed305-f783-4fd0-a608-0a94d0a62b93';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'evidence','signals','cases','diagnoses','decisions','actions','outcomes','learnings',
    'case_evidence','signal_evidence','case_signals'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "bci_internal_access" ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY "bci_internal_access" ON public.%I FOR ALL TO authenticated USING ((select auth.uid()) = %L::uuid) WITH CHECK ((select auth.uid()) = %L::uuid)',
      tbl, target_user, target_user
    );
  END LOOP;
END $$;
