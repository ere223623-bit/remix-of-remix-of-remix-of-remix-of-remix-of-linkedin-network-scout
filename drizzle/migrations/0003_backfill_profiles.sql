-- Users created before the profile trigger was installed have no profile row.
-- Backfill them without overwriting any existing profile data.
INSERT INTO public.profiles (user_id, display_name, avatar_url)
SELECT
  users.id,
  COALESCE(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name'),
  COALESCE(users.raw_user_meta_data ->> 'avatar_url', users.raw_user_meta_data ->> 'picture')
FROM auth.users AS users
ON CONFLICT (user_id) DO NOTHING;

-- Keep future sign-ups idempotent if another trusted workflow creates the
-- profile before this trigger runs.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
