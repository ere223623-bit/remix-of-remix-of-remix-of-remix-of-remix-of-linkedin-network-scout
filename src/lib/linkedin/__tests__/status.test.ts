import { describe, expect, it } from "vitest";

import { deriveIntegrationStatus } from "../status";

describe("deriveIntegrationStatus", () => {
  it("distinguishes an unconfigured integration from an offline service", () => {
    const status = deriveIntegrationStatus(null, {
      state: "CONFIGURATION_ERROR",
      message: "No LinkedIn search provider is configured.",
    });

    expect(status).toMatchObject({
      key: "NOT_CONFIGURED",
      label: "Search service not configured",
      connected: false,
      authenticated: false,
      searchSupported: false,
    });
  });
});
