import {
  CheckoutGuard,
  MemoryGuardStore,
  defaultLimits,
  envSecretStore,
  layeredSecretStore,
  type Provider,
  type SecretStore,
} from "@ecomkit/core";
import { createMockProvider } from "@ecomkit/provider-mock";
import type { Runtime } from "./runtime.ts";

export function memorySecretStore(): SecretStore & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    backend: "memory",
    values,
    get: async (provider, key) => values.get(`${provider}/${key}`),
    set: async (provider, key, value) => {
      values.set(`${provider}/${key}`, value);
    },
    delete: async (provider, key) => values.delete(`${provider}/${key}`),
  };
}

const boardProvider: Provider = {
  id: "board",
  title: "Classifieds without a cart",
  secrets: [{ key: "token", label: "Board API token" }],
  notes: ["Messages are read-only."],
  async search(_query, ctx) {
    await ctx.secrets.require("token");
    return { items: [] };
  },
  commands: {
    messages: {
      description: "List chat messages",
      run: async (args) => ({ messages: [], args }),
    },
  },
};

const smsProvider: Provider = {
  id: "sms",
  title: "Shop with a one-time code login",
  secrets: [{ key: "session", label: "Session token" }],
  async login(ask, ctx, { codeSent }) {
    const phone = codeSent ? "sent" : await ask("Phone", { visible: true });
    const code = await ask(`Code sent to ${phone}`, { visible: true });
    await ctx.secrets.set("session", `${phone}:${code}`);
  },
};

export function testRuntime(keychain = memorySecretStore()): Runtime {
  return {
    providers: new Map([
      ["mock", createMockProvider()],
      ["board", boardProvider],
      ["sms", smsProvider],
    ]),
    secrets: layeredSecretStore(envSecretStore({}), keychain),
    guard: new CheckoutGuard({
      limits: defaultLimits,
      store: new MemoryGuardStore(),
    }),
    config: { limits: defaultLimits },
    paths: { configFile: "/cfg/config.json", stateFile: "/state/guard.json" },
  };
}
