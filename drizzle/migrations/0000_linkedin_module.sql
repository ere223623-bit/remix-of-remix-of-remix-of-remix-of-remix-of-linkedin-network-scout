-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Search history
CREATE TABLE public.linkedin_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  search_type text NOT NULL CHECK (search_type IN ('people','companies','jobs')),
  query text NOT NULL DEFAULT '',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_count integer NOT NULL DEFAULT 0,
  backend text,
  status text NOT NULL DEFAULT 'READY',
  error_code text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_searches TO authenticated;
GRANT ALL ON public.linkedin_searches TO service_role;
ALTER TABLE public.linkedin_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own searches select" ON public.linkedin_searches FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own searches insert" ON public.linkedin_searches FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own searches delete" ON public.linkedin_searches FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX linkedin_searches_user_created_idx ON public.linkedin_searches (user_id, created_at DESC);

-- Result cache (results actually retrieved, used for the detail page)
CREATE TABLE public.linkedin_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  search_id uuid REFERENCES public.linkedin_searches(id) ON DELETE CASCADE,
  result_type text NOT NULL CHECK (result_type IN ('people','companies','jobs')),
  payload jsonb NOT NULL,
  source text NOT NULL DEFAULT 'linkedin',
  backend text,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_results TO authenticated;
GRANT ALL ON public.linkedin_results TO service_role;
ALTER TABLE public.linkedin_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own results select" ON public.linkedin_results FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own results insert" ON public.linkedin_results FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own results delete" ON public.linkedin_results FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX linkedin_results_search_idx ON public.linkedin_results (search_id);

-- Saved profiles
CREATE TABLE public.linkedin_saved_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  profile_url text,
  name text,
  headline text,
  job_title text,
  company text,
  location text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  favorite boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'linkedin',
  retrieved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_saved_profiles TO authenticated;
GRANT ALL ON public.linkedin_saved_profiles TO service_role;
ALTER TABLE public.linkedin_saved_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own saved select" ON public.linkedin_saved_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own saved insert" ON public.linkedin_saved_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own saved update" ON public.linkedin_saved_profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own saved delete" ON public.linkedin_saved_profiles FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE UNIQUE INDEX linkedin_saved_unique_url ON public.linkedin_saved_profiles (user_id, profile_url) WHERE profile_url IS NOT NULL;

-- Integration diagnostics (health checks / metrics), readable by admins only
CREATE TABLE public.linkedin_integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  status text NOT NULL,
  backend text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.linkedin_integration_events TO authenticated;
GRANT ALL ON public.linkedin_integration_events TO service_role;
ALTER TABLE public.linkedin_integration_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read integration events"
  ON public.linkedin_integration_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX linkedin_integration_events_created_idx ON public.linkedin_integration_events (created_at DESC);