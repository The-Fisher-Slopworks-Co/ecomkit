import { describe, expect, test } from "bun:test";
import {
  bunSecretStore,
  envKey,
  usableKeychain,
  envSecretStore,
  layeredSecretStore,
  providerSecrets,
  type SecretStore,
} from "./secrets.ts";

function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    backend: "memory",
    get: async (provider, key) => values.get(`${provider}/${key}`),
    set: async (provider, key, value) => {
      values.set(`${provider}/${key}`, value);
    },
    delete: async (provider, key) => values.delete(`${provider}/${key}`),
  };
}

describe("secrets", () => {
  test("derives environment variable names", () => {
    expect(envKey("yandex-lavka", "token")).toBe("ECOM_YANDEX_LAVKA_TOKEN");
  });

  test("environment overrides the keychain, writes go to the keychain", async () => {
    const keychain = memoryStore();
    await keychain.set("ozon", "token", "from-keychain");
    await keychain.set("avito", "token", "avito-keychain");
    const store = layeredSecretStore(
      envSecretStore({ ECOM_OZON_TOKEN: "from-env" }),
      keychain,
    );

    expect(store.backend).toBe("env+memory");
    expect(await store.get("ozon", "token")).toBe("from-env");
    expect(await store.get("avito", "token")).toBe("avito-keychain");

    await store.set("samokat", "token", "new");
    expect(await keychain.get("samokat", "token")).toBe("new");
  });

  test("the environment alone cannot store secrets", async () => {
    const store = layeredSecretStore(envSecretStore({}), undefined);

    await expect(store.set("ozon", "token", "x")).rejects.toMatchObject({
      code: "secret_store_unavailable",
    });
  });

  test("uses Bun.secrets when the runtime has it", async () => {
    const calls: unknown[] = [];
    const runtime = {
      Bun: {
        secrets: {
          get: async (options: unknown) => {
            calls.push(options);
            return null;
          },
          set: async () => {},
          delete: async () => true,
        },
      },
    };

    const store = bunSecretStore(runtime);

    expect(store?.backend).toBe("bun-secrets");
    expect(await store?.get("ozon", "token")).toBeUndefined();
    expect(calls).toEqual([{ service: "ecomkit.ozon", name: "token" }]);
    expect(bunSecretStore({})).toBeUndefined();
  });

  test("skips a keychain that fails when probed", async () => {
    const broken: SecretStore = {
      ...memoryStore(),
      backend: "broken",
      get: async () => {
        throw new Error("no secret service");
      },
    };

    const chosen = await usableKeychain([
      async () => broken,
      async () => undefined,
      async () => {
        throw new Error("native module missing");
      },
      async () => memoryStore(),
    ]);

    expect(chosen?.backend).toBe("memory");
    expect(await usableKeychain([async () => broken])).toBeUndefined();
  });

  test("require points at ecom login", async () => {
    const secrets = providerSecrets(envSecretStore({}), "ozon");

    await expect(secrets.require("token")).rejects.toThrow("ecom login ozon");
  });
});
