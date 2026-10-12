import type { Provider } from "@ecomkit/core";
import { createMockProvider } from "@ecomkit/provider-mock";

export function createProviders(): Map<string, Provider> {
  return new Map(
    [createMockProvider()].map((provider) => [provider.id, provider]),
  );
}
