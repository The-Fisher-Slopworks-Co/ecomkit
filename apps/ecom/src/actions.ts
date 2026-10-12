import {
  EcomError,
  capabilities,
  type Capability,
  type CheckoutResult,
  type Provider,
  type ProviderContext,
  type SearchQuery,
} from "@ecomkit/core";
import { providerContext, type Runtime } from "./runtime.ts";

export function getProvider(runtime: Runtime, id: string): Provider {
  const provider = runtime.providers.get(id);
  if (!provider) {
    const known = [...runtime.providers.keys()].join(", ");
    throw new EcomError(
      "unknown_provider",
      `Unknown provider ${id}; known: ${known}`,
    );
  }
  return provider;
}

function capability<K extends Capability>(
  runtime: Runtime,
  id: string,
  name: K,
): [NonNullable<Provider[K]>, ProviderContext] {
  const provider = getProvider(runtime, id);
  const method = provider[name];
  if (method === undefined) {
    throw new EcomError("unsupported", `${id} does not support ${name}`);
  }
  return [
    method.bind(provider) as NonNullable<Provider[K]>,
    providerContext(runtime, provider),
  ];
}

export function listProviders(runtime: Runtime) {
  return [...runtime.providers.values()].map((provider) => ({
    id: provider.id,
    title: provider.title,
    capabilities: capabilities(provider),
    commands: Object.entries(provider.commands ?? {}).map(
      ([name, command]) => ({ name, description: command.description }),
    ),
    secrets: provider.secrets.map((field) => field.key),
  }));
}

export function search(runtime: Runtime, id: string, query: SearchQuery) {
  const [method, ctx] = capability(runtime, id, "search");
  return method(query, ctx);
}

export function product(runtime: Runtime, id: string, productId: string) {
  const [method, ctx] = capability(runtime, id, "product");
  return method(productId, ctx);
}

export function cart(runtime: Runtime, id: string) {
  const [method, ctx] = capability(runtime, id, "cart");
  return method(ctx);
}

export function setCartItem(
  runtime: Runtime,
  id: string,
  productId: string,
  quantity: number,
) {
  const [method, ctx] = capability(runtime, id, "setCartItem");
  return method(productId, quantity, ctx);
}

export function checkout(
  runtime: Runtime,
  id: string,
  confirm?: string,
): Promise<CheckoutResult> {
  const provider = getProvider(runtime, id);
  return runtime.guard.checkout(
    provider,
    providerContext(runtime, provider),
    confirm,
  );
}

export function orders(runtime: Runtime, id: string) {
  const [method, ctx] = capability(runtime, id, "orders");
  return method(ctx);
}

export function order(runtime: Runtime, id: string, orderId: string) {
  const [method, ctx] = capability(runtime, id, "order");
  return method(orderId, ctx);
}

export function runCommand(
  runtime: Runtime,
  id: string,
  name: string,
  args: readonly string[],
) {
  const provider = getProvider(runtime, id);
  const commands = provider.commands ?? {};
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) {
    throw new EcomError("unsupported", `${id} has no command ${name}`);
  }
  return command.run(args, providerContext(runtime, provider));
}
