/**
 * Browser-safe Supabase configuration for the Lovable deployment.
 *
 * Supabase publishable keys are intentionally public and are included in the
 * browser bundle. Authorization is enforced by Row Level Security, never by
 * keeping this key secret. Do not add service-role or secret keys here.
 *
 * VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY override these defaults
 * when a deployment needs to target a different Supabase project.
 */
export const bundledSupabasePublicConfig = Object.freeze({
  url: "https://eufkzwfoxlxvjislcqwb.supabase.co",
  publishableKey: "sb_publishable_VH-qFD4dA8R-Ijeq067e2Q_hbBJR0pA",
});
