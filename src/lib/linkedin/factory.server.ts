import {
  AgentReachLinkedInProvider,
  readAgentReachConfig,
} from "./agent-reach-provider.server";
import { CompositeLinkedInProvider } from "./composite-provider.server";
import { LovableLinkedInProvider, readLovableLinkedInConfig } from "./lovable-provider.server";
import { PROVIDER_ERRORS } from "./provider";
import type { LinkedInProvider, ProviderSearchArgs, ProviderSearchResult } from "./provider";
import type { PersonResult, CompanyResult, JobResult, ProviderCapabilities } from "./types";

/** The two concrete providers, built independently for diagnostics. */
export function createProviderPair(): { primary: LinkedInProvider; fallback: LinkedInProvider } {
  let primary: LinkedInProvider;
  try {
    primary = new LovableLinkedInProvider(readLovableLinkedInConfig());
  } catch (error) {
    primary = new UnconfiguredProvider(
      "lovable-linkedin",
      "Lovable LinkedIn connector (not configured)",
      error,
    );
  }

  // Agent Reach may be unconfigured; in that case we still create it but health
  // checks will report unavailable. This keeps the composite selector simple.
  let fallback: LinkedInProvider;
  try {
    fallback = new AgentReachLinkedInProvider(readAgentReachConfig());
  } catch {
    fallback = new UnconfiguredAgentReachProvider();
  }

  return { primary, fallback };
}

export function createLinkedInProvider(): LinkedInProvider {
  const { primary, fallback } = createProviderPair();
  return new CompositeLinkedInProvider(primary, fallback);
}

class UnconfiguredProvider implements LinkedInProvider {
  private readonly error: ReturnType<typeof PROVIDER_ERRORS.configuration>;

  constructor(
    readonly id: string,
    readonly label: string,
    cause?: unknown,
  ) {
    this.error =
      cause instanceof Error && cause.name === "LinkedInProviderError"
        ? (cause as ReturnType<typeof PROVIDER_ERRORS.configuration>)
        : PROVIDER_ERRORS.configuration(`${label} is not configured.`);
  }

  async healthCheck(): Promise<ProviderCapabilities> {
    throw this.error;
  }
  async getCapabilities(): Promise<ProviderCapabilities> {
    throw this.error;
  }
  async searchPeople(_args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult>> {
    throw this.error;
  }
  async searchCompanies(_args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult>> {
    throw this.error;
  }
  async searchJobs(_args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult>> {
    throw this.error;
  }
  async getProfile(_profileUrl: string): Promise<PersonResult> {
    throw this.error;
  }
}

class UnconfiguredAgentReachProvider implements LinkedInProvider {
  readonly id = "agent-reach";
  readonly label = "Agent Reach sidecar (not configured)";
  private readonly error = PROVIDER_ERRORS.configuration(
    "The Agent Reach sidecar is not configured.",
  );

  async healthCheck(): Promise<ProviderCapabilities> {
    throw this.error;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    throw this.error;
  }

  async searchPeople(_args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult>> {
    throw this.error;
  }

  async searchCompanies(_args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult>> {
    throw this.error;
  }

  async searchJobs(_args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult>> {
    throw this.error;
  }

  async getProfile(_profileUrl: string): Promise<PersonResult> {
    throw this.error;
  }
}
