import type { ProviderAdapter, ProviderCapabilities, ProviderDefinition, ProviderInvocationOptions, ProviderInvocationResult } from "./types";

export abstract class BaseProviderAdapter implements ProviderAdapter {
  id: ProviderDefinition["id"];
  displayName: string;
  locality: ProviderDefinition["locality"];
  defaultBaseUrl?: string;
  capabilities: ProviderCapabilities;
  notes?: string[];

  constructor(definition: ProviderDefinition) {
    this.id = definition.id;
    this.displayName = definition.displayName;
    this.locality = definition.locality;
    this.defaultBaseUrl = definition.defaultBaseUrl;
    this.capabilities = definition.capabilities;
    this.notes = definition.notes;
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: "Adapter scaffold only; runtime implementation pending." };
  }

  async invoke(_options: ProviderInvocationOptions): Promise<ProviderInvocationResult> {
    throw new Error(`Provider adapter "${this.id}" is not implemented yet.`);
  }
}
