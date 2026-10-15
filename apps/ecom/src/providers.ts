import type { Provider } from "@ecomkit/core";
import { createLifemartProvider } from "@ecomkit/provider-lifemart";
import { createMagnitProvider } from "@ecomkit/provider-magnit";
import { createMockProvider } from "@ecomkit/provider-mock";

export function createProviders(): Map<string, Provider> {
  return new Map(
    [
      createMockProvider(),
      createMagnitProvider(),
      createLifemartProvider(),
    ].map((provider) => [provider.id, provider]),
  );
}
