import { EcomError } from "./errors.ts";

export interface SecretStore {
  readonly backend: string;
  get(provider: string, key: string): Promise<string | undefined>;
  set(provider: string, key: string, value: string): Promise<void>;
  delete(provider: string, key: string): Promise<boolean>;
}

export interface ProviderSecrets {
  get(key: string): Promise<string | undefined>;
  require(key: string): Promise<string>;
}

type Env = Readonly<Record<string, string | undefined>>;

const SERVICE_PREFIX = "ecomkit";

function service(provider: string): string {
  return `${SERVICE_PREFIX}.${provider}`;
}

export function envKey(provider: string, key: string): string {
  return `ECOM_${provider}_${key}`.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function envSecretStore(env: Env = process.env): SecretStore {
  return {
    backend: "env",
    get: async (provider, key) => env[envKey(provider, key)] || undefined,
    set: async () => {
      throw new EcomError(
        "secret_store_unavailable",
        "No system keychain is available; set the ECOM_<PROVIDER>_<KEY> environment variables instead",
      );
    },
    delete: async () => false,
  };
}

interface BunSecrets {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

export function bunSecretStore(
  runtime: unknown = globalThis,
): SecretStore | undefined {
  const secrets = (runtime as { Bun?: { secrets?: BunSecrets } }).Bun?.secrets;
  if (secrets === undefined) return undefined;
  return {
    backend: "bun-secrets",
    get: async (provider, key) =>
      (await secrets.get({ service: service(provider), name: key })) ??
      undefined,
    set: (provider, key, value) =>
      secrets.set({ service: service(provider), name: key, value }),
    delete: (provider, key) =>
      secrets.delete({ service: service(provider), name: key }),
  };
}

async function keyringSecretStore(): Promise<SecretStore | undefined> {
  let keyring: typeof import("@napi-rs/keyring");
  try {
    keyring = await import("@napi-rs/keyring");
  } catch {
    return undefined;
  }
  const entry = (provider: string, key: string) =>
    new keyring.AsyncEntry(service(provider), key);
  return {
    backend: "keyring",
    get: async (provider, key) =>
      (await entry(provider, key).getPassword()) ?? undefined,
    set: (provider, key, value) => entry(provider, key).setPassword(value),
    delete: (provider, key) => entry(provider, key).deleteCredential(),
  };
}

export function layeredSecretStore(
  env: SecretStore,
  keychain: SecretStore | undefined,
): SecretStore {
  if (keychain === undefined) return env;
  return {
    backend: `${env.backend}+${keychain.backend}`,
    get: async (provider, key) =>
      (await env.get(provider, key)) ?? (await keychain.get(provider, key)),
    set: (provider, key, value) => keychain.set(provider, key, value),
    delete: (provider, key) => keychain.delete(provider, key),
  };
}

export async function usableKeychain(
  candidates: readonly (() => Promise<SecretStore | undefined>)[],
): Promise<SecretStore | undefined> {
  for (const candidate of candidates) {
    const store = await candidate().catch(() => undefined);
    if (store === undefined) continue;
    try {
      await store.get("ecom", "probe");
      return store;
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function createSecretStore(
  env: Env = process.env,
): Promise<SecretStore> {
  return layeredSecretStore(
    envSecretStore(env),
    await usableKeychain([async () => bunSecretStore(), keyringSecretStore]),
  );
}

export function providerSecrets(
  store: SecretStore,
  provider: string,
): ProviderSecrets {
  return {
    get: (key) => store.get(provider, key),
    async require(key) {
      const value = await store.get(provider, key);
      if (value === undefined) {
        throw new EcomError(
          "auth_required",
          `Missing ${key} for ${provider}; run \`ecom login ${provider}\``,
        );
      }
      return value;
    },
  };
}
