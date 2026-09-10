import {
  AgentReachLinkedInProvider,
  readAgentReachConfig,
} from "./agent-reach-provider.server";
import { ApolloResearchProvider, readApolloConfig } from "./apollo-provider.server";
import { CompositeLinkedInProvider } from "./composite-provider.server";
import { LovableLinkedInProvider, readLovableLinkedInConfig } from "./lovable-provider.server";
import { PROVIDER_ERRORS } from "./provider";
import type { LinkedInProvider, ProviderSearchArgs, ProviderSearchResult } from "./provider";
import type { PersonResult, CompanyResult, JobResult, ProviderCapabilities } from "./types";

export type ProviderId = "lovable-linkedin" | "apollo" | "agent-reach";

export type ProviderSet = {
  linkedInConnector: LinkedInProvider;
  apollo: LinkedInProvider;
  agentReach: LinkedInProvider;
};

/** All concrete providers, built independently so diagnostics can report each. */
export function createProviderSet(): ProviderSet {
  let linkedInConnector: LinkedInProvider;
  try {
    linkedInConnector = new LovableLinkedInProvider(readLovableLinkedInConfig());
  } catch (error) {
    linkedInConnector = new UnconfiguredProvider(
      "lovable-linkedin",
      "Lovable LinkedIn connector (not configured)",
      error,
    );
  }

  let apollo: LinkedInProvider;
  try {
    apollo = new ApolloResearchProvider(readApolloConfig());
  } catch (error) {
    apollo = new UnconfiguredProvider("apollo", "Apollo professional data (not connected)", error);
  }

  // Agent Reach may be unconfigured; in that case we still create it but health
  // checks will report unavailable. This keeps the composite selector simple.
  let agentReach: LinkedInProvider;
  try {
    agentReach = new AgentReachLinkedInProvider(readAgentReachConfig());
  } catch {
    agentReach = new UnconfiguredAgentReachProvider();
  }

  return { linkedInConnector, apollo, agentReach };
}

/** Kept for callers that only need the two LinkedIn-sourced backends. */
export function createProviderPair(): { primary: LinkedInProvider; fallback: LinkedInProvider } {
  const { linkedInConnector, agentReach } = createProviderSet();
  return { primary: linkedInConnector, fallback: agentReach };
}

export function createLinkedInProvider(): LinkedInProvider {
  const { linkedInConnector, apollo, agentReach } = createProviderSet();
  return new CompositeLinkedInProvider(linkedInConnector, apollo, agentReach);
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
