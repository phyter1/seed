import { listProviderAdapters } from "./index";

const providers = listProviderAdapters().map((provider) => ({
  id: provider.id,
  displayName: provider.displayName,
  locality: provider.locality,
  tier: provider.tier,
  defaultBaseUrl: provider.defaultBaseUrl,
  capabilities: provider.capabilities,
  notes: provider.notes ?? [],
}));

process.stdout.write(`${JSON.stringify({ providers }, null, 2)}\n`);
