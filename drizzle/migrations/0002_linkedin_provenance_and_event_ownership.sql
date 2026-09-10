-- Preserve explicit provenance for every persisted search and result.
ALTER TABLE public.linkedin_searches
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'linkedin'
    CHECK (source IN ('linkedin', 'apollo', 'apify')),
  ADD COLUMN IF NOT EXISTS is_linkedin_sourced boolean NOT NULL DEFAULT true;

UPDATE public.linkedin_searches
SET provider = CASE
    WHEN backend = 'apollo' THEN 'apollo'
    WHEN backend = 'mcp-server-linkedin' THEN 'agent-reach'
    WHEN backend = 'linkedin-gateway' THEN 'lovable-linkedin'
    ELSE provider
  END,
  source = CASE WHEN backend = 'apollo' THEN 'apollo' ELSE 'linkedin' END,
  is_linkedin_sourced = backend IS DISTINCT FROM 'apollo'
WHERE provider IS NULL;

ALTER TABLE public.linkedin_results
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS is_linkedin_sourced boolean NOT NULL DEFAULT true;

UPDATE public.linkedin_results
SET provider = CASE
    WHEN backend = 'apollo' OR source = 'apollo' THEN 'apollo'
    WHEN backend = 'mcp-server-linkedin' THEN 'agent-reach'
    WHEN backend = 'linkedin-gateway' THEN 'lovable-linkedin'
    ELSE provider
  END,
  is_linkedin_sourced = source = 'linkedin'
WHERE provider IS NULL;

ALTER TABLE public.linkedin_saved_profiles
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS is_linkedin_sourced boolean NOT NULL DEFAULT true;

UPDATE public.linkedin_saved_profiles
SET provider = CASE WHEN source = 'apollo' THEN 'apollo' ELSE provider END,
    is_linkedin_sourced = source = 'linkedin'
WHERE provider IS NULL;

-- Events are generated in authenticated server functions. Associate every new
-- event with its caller so ordinary users cannot observe another user's activity.
ALTER TABLE public.linkedin_integration_events
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT INSERT ON public.linkedin_integration_events TO authenticated;

DROP POLICY IF EXISTS "Admins read integration events" ON public.linkedin_integration_events;
CREATE POLICY "Own or admin integration events select"
  ON public.linkedin_integration_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Own integration events insert"
  ON public.linkedin_integration_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Make allowed updates explicit while retaining ownership on both sides of an
-- update. Cross-user changes remain rejected by RLS.
CREATE POLICY "Own searches update"
  ON public.linkedin_searches FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own results update"
  ON public.linkedin_results FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- A result may only reference a search owned by the same authenticated user.
DROP POLICY IF EXISTS "Own results insert" ON public.linkedin_results;
CREATE POLICY "Own results insert"
  ON public.linkedin_results FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      search_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.linkedin_searches s
        WHERE s.id = search_id AND s.user_id = auth.uid()
      )
    )
  );

-- profiles.role is display data only; authorization uses user_roles/has_role.
-- Prevent users from self-promoting through the otherwise broad profile grant.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_url, job_title, company, preferences, updated_at)
  ON public.profiles TO authenticated;
