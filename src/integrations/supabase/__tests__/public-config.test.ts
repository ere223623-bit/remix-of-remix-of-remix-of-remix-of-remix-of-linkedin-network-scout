import { describe, expect, it } from 'vitest';

import { bundledSupabasePublicConfig } from '../public-config';

describe('bundled Supabase public configuration', () => {
  it('contains a deployable project URL and a browser-safe publishable key', () => {
    expect(bundledSupabasePublicConfig.url).toMatch(
      /^https:\/\/[a-z0-9]+\.supabase\.co$/,
    );
    expect(bundledSupabasePublicConfig.publishableKey).toMatch(/^sb_publishable_/);
    expect(bundledSupabasePublicConfig.publishableKey).not.toMatch(/^sb_secret_/);
  });

  it('initializes the Supabase client without environment variables', async () => {
    const { supabase } = await import('../client');

    expect(supabase.auth).toBeDefined();
  });
});
