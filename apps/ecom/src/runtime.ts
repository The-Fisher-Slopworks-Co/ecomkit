import {
  CheckoutGuard,
  FileGuardStore,
  createHttpClient,
  createSecretStore,
  ecomPaths,
  loadConfig,
  providerSecrets,
  type EcomConfig,
  type EcomPaths,
  type Provider,
  type ProviderContext,
  type SecretStore,
} from "@ecomkit/core";
import { createProviders } from "./providers.ts";

export interface Runtime {
  readonly providers: ReadonlyMap<string, Provider>;
  readonly secrets: SecretStore;
  readonly guard: CheckoutGuard;
  readonly config: EcomConfig;
  readonly paths: EcomPaths;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export async function createRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Runtime> {
  const paths = ecomPaths(env);
  const config = await loadConfig(env, paths);
  return {
    providers: createProviders(),
    secrets: await createSecretStore(env),
    guard: new CheckoutGuard({
      limits: config.limits,
      store: new FileGuardStore(paths.stateFile),
    }),
    config,
    paths,
  };
}

export function providerContext(
  runtime: Runtime,
  provider: Provider,
): ProviderContext {
  return {
    secrets: providerSecrets(runtime.secrets, provider.id),
    http: (baseUrl) =>
      createHttpClient({
        baseUrl,
        ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      }),
  };
}
