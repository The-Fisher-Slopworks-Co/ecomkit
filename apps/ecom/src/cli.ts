import { parseArgs } from "node:util";
import { EcomError, formatMoney, type AskOptions } from "@ecomkit/core";
import pkg from "../package.json" with { type: "json" };
import * as actions from "./actions.ts";
import { errorPayload } from "./errors.ts";
import {
  formatCart,
  formatCheckout,
  formatOrder,
  formatOrders,
  formatProduct,
  formatProducts,
} from "./format.ts";
import { providerContext, type Runtime } from "./runtime.ts";

export const version = pkg.version;

export interface CliDeps {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readSecret: (label: string) => Promise<string>;
  readonly readLine: (label: string) => Promise<string>;
  readonly createRuntime: () => Promise<Runtime>;
  readonly serveMcp: (runtime: Runtime) => Promise<void>;
}

interface Output {
  readonly data: unknown;
  readonly text: string;
}

type Flags = ReturnType<typeof parse>["values"];

const usage = `ecom ${version}: e-commerce and delivery services for AI agents

Usage:
  ecom <provider> <command> [args] [--json]
  ecom providers               list providers and what they support
  ecom login <provider>        store the provider's secrets in the keychain
    [--code]                   enter a code that was already sent, without a new one
  ecom logout <provider>       remove them
  ecom doctor                  check the runtime, secret store and limits
  ecom mcp                     serve MCP over stdio

Provider commands:
  search <text> [--limit n] [--cursor c]
  product <id>
  cart
  add <id> [--qty n]
  remove <id>
  checkout [--confirm <code>]  without --confirm only previews and prints the code
  orders
  order <id>
  <provider-specific command> [args]

ecom <provider> --help         that provider's own commands and notes`;

const builtins = new Set([
  "help",
  "providers",
  "doctor",
  "login",
  "logout",
  "mcp",
]);

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      confirm: { type: "string" },
      qty: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
      code: { type: "boolean" },
    },
  });
}

export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  let json = argv.includes("--json");
  try {
    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(argv);
    } catch (error) {
      throw new EcomError("invalid_input", (error as Error).message);
    }
    const { values, positionals } = parsed;
    json = values.json === true;
    const [first, ...rest] = positionals;

    if (values.version) {
      deps.stdout(version);
      return 0;
    }
    if (first === undefined) {
      deps.stdout(usage);
      return 0;
    }
    const help = first === "help" || values.help;
    const topic = first === "help" ? rest[0] : first;
    const helpFor =
      help && topic !== undefined && !builtins.has(topic) ? topic : undefined;
    if (help && helpFor === undefined) {
      deps.stdout(usage);
      return 0;
    }

    const runtime = await deps.createRuntime();
    if (helpFor !== undefined) {
      const output = providerHelp(runtime, helpFor);
      deps.stdout(json ? JSON.stringify(output.data, null, 2) : output.text);
      return 0;
    }
    if (first === "mcp") {
      await deps.serveMcp(runtime);
      return 0;
    }
    const output = await dispatch(runtime, first, rest, values, deps);
    deps.stdout(json ? JSON.stringify(output.data, null, 2) : output.text);
    return 0;
  } catch (error) {
    const payload = errorPayload(error);
    if (json) {
      deps.stdout(JSON.stringify(payload, null, 2));
    } else {
      deps.stderr(`error: ${payload.error.message}`);
    }
    return 1;
  }
}

async function dispatch(
  runtime: Runtime,
  first: string,
  rest: readonly string[],
  flags: Flags,
  deps: CliDeps,
): Promise<Output> {
  switch (first) {
    case "providers": {
      const data = actions.listProviders(runtime);
      return {
        data,
        text: data
          .map((p) => `${p.id}  ${p.title}\n  ${p.capabilities.join(", ")}`)
          .join("\n"),
      };
    }
    case "doctor":
      return doctor(runtime);
    case "login":
      return login(runtime, required(rest[0], "provider"), deps, flags);
    case "logout":
      return logout(runtime, required(rest[0], "provider"));
    default:
      return providerCommand(runtime, first, rest, flags);
  }
}

function providerHelp(runtime: Runtime, id: string): Output {
  const data = actions.describeProvider(runtime, id);
  const width = Math.max(0, ...data.commands.map((c) => c.name.length));
  const text = [
    `ecom ${id}: ${data.title}`,
    `Supports: ${data.capabilities.join(", ")}`,
    ...(data.commands.length === 0
      ? []
      : [
          "",
          "Commands:",
          ...data.commands.map(
            (c) => `  ${c.name.padEnd(width)}  ${c.description}`,
          ),
        ]),
    ...(data.notes.length === 0
      ? []
      : ["", "Notes:", ...data.notes.map((note) => `- ${note}`)]),
  ].join("\n");
  return { data, text };
}

async function providerCommand(
  runtime: Runtime,
  id: string,
  [command, ...args]: readonly string[],
  flags: Flags,
): Promise<Output> {
  actions.getProvider(runtime, id);
  switch (command) {
    case undefined: {
      const data = actions.describeProvider(runtime, id);
      return { data, text: JSON.stringify(data, null, 2) };
    }
    case "search": {
      const data = await actions.search(runtime, id, {
        text: required(args.join(" ").trim() || undefined, "search text"),
        ...(flags.limit === undefined
          ? {}
          : { limit: integer(flags.limit, "--limit", 1) }),
        ...(flags.cursor === undefined ? {} : { cursor: flags.cursor }),
      });
      return { data, text: formatProducts(data) };
    }
    case "product": {
      const data = await actions.product(runtime, id, required(args[0], "id"));
      return { data, text: formatProduct(data) };
    }
    case "cart": {
      const data = await actions.cart(runtime, id);
      return { data, text: formatCart(data) };
    }
    case "add": {
      const productId = required(args[0], "id");
      const qty = integer(flags.qty ?? "1", "--qty", 1);
      const current = await actions.cart(runtime, id);
      const inCart =
        current.items.find((item) => item.product.id === productId)?.quantity ??
        0;
      const data = await actions.setCartItem(
        runtime,
        id,
        productId,
        inCart + qty,
      );
      return { data, text: formatCart(data) };
    }
    case "remove": {
      const data = await actions.setCartItem(
        runtime,
        id,
        required(args[0], "id"),
        0,
      );
      return { data, text: formatCart(data) };
    }
    case "checkout": {
      const data = await actions.checkout(runtime, id, flags.confirm);
      return { data, text: formatCheckout(id, data) };
    }
    case "orders": {
      const data = await actions.orders(runtime, id);
      return { data, text: formatOrders(data) };
    }
    case "order": {
      const data = await actions.order(runtime, id, required(args[0], "id"));
      return { data, text: formatOrder(data) };
    }
    default: {
      const data = await actions.runCommand(runtime, id, command, args);
      return { data, text: JSON.stringify(data, null, 2) };
    }
  }
}

async function doctor(runtime: Runtime): Promise<Output> {
  const bun = process.versions["bun"];
  const providers = await Promise.all(
    [...runtime.providers.values()].map(async (provider) => ({
      id: provider.id,
      secrets: Object.fromEntries(
        await Promise.all(
          provider.secrets.map(async ({ key }) => [
            key,
            (await runtime.secrets.get(provider.id, key)) !== undefined,
          ]),
        ),
      ) as Record<string, boolean>,
    })),
  );
  const data = {
    version,
    runtime: bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`,
    secretStore: runtime.secrets.backend,
    configFile: runtime.paths.configFile,
    stateFile: runtime.paths.stateFile,
    limits: runtime.config.limits,
    providers,
  };
  const text = [
    `ecom ${version} on ${data.runtime}`,
    `secrets: ${data.secretStore}`,
    `config: ${data.configFile}`,
    `limits: ${formatMoney(data.limits.perOrder)} per order, ${formatMoney(data.limits.perDay)} per 24 hours`,
    ...providers.map((p) => {
      const missing = Object.entries(p.secrets)
        .filter(([, present]) => !present)
        .map(([key]) => key);
      return `${p.id}: ${missing.length === 0 ? "ready" : `missing ${missing.join(", ")}`}`;
    }),
  ].join("\n");
  return { data, text };
}

async function login(
  runtime: Runtime,
  id: string,
  deps: CliDeps,
  flags: Flags,
): Promise<Output> {
  const provider = actions.getProvider(runtime, id);
  const ask = async (label: string, options?: AskOptions) => {
    const read = options?.visible ? deps.readLine : deps.readSecret;
    const value = (await read(label)).trim();
    if (value === "") {
      throw new EcomError("invalid_input", `${label} is required`);
    }
    return value;
  };
  if (provider.login) {
    await provider.login(ask, providerContext(runtime, provider), {
      codeSent: flags.code === true,
    });
  } else if (flags.code) {
    throw new EcomError("invalid_input", `${id} does not sign in with a code`);
  } else {
    for (const field of provider.secrets) {
      await runtime.secrets.set(id, field.key, await ask(field.label));
    }
  }
  const stored: string[] = [];
  for (const field of provider.secrets) {
    if ((await runtime.secrets.get(id, field.key)) !== undefined) {
      stored.push(field.key);
    }
  }
  return {
    data: { provider: id, stored, backend: runtime.secrets.backend },
    text:
      stored.length === 0
        ? `${id} needs no login`
        : `Stored ${stored.join(", ")} for ${id}`,
  };
}

async function logout(runtime: Runtime, id: string): Promise<Output> {
  const provider = actions.getProvider(runtime, id);
  const removed: string[] = [];
  for (const field of provider.secrets) {
    if (await runtime.secrets.delete(id, field.key)) removed.push(field.key);
  }
  return {
    data: { provider: id, removed },
    text:
      removed.length === 0
        ? `Nothing stored for ${id}`
        : `Removed ${removed.join(", ")} for ${id}`,
  };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new EcomError("invalid_input", `Missing ${name}; see ecom --help`);
  }
  return value;
}

function integer(raw: string, name: string, min: number): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new EcomError(
      "invalid_input",
      `${name} must be an integer ≥ ${min}, got ${raw}`,
    );
  }
  return value;
}
