import type { Provider } from "@ecomkit/core";
import { createMagnitProvider } from "@ecomkit/provider-magnit";
import { createMockProvider } from "@ecomkit/provider-mock";

export function createProviders(): Map<string, Provider> {
  return new Map(
    [createMockProvider(), createMagnitProvider()].map((provider) => [
      provider.id,
      provider,
    ]),
  );
}
