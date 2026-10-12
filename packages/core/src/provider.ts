import type { HttpClient } from "./http.ts";
import type { ProviderSecrets } from "./secrets.ts";
import type {
  Cart,
  CheckoutPreview,
  Order,
  Page,
  Product,
  SearchQuery,
} from "./types.ts";

export interface ProviderContext {
  readonly secrets: ProviderSecrets;
  readonly http: (baseUrl: string) => HttpClient;
}

export interface SecretField {
  readonly key: string;
  readonly label: string;
}

export interface AskOptions {
  readonly visible?: boolean;
}

export type Ask = (label: string, options?: AskOptions) => Promise<string>;

export interface LoginOptions {
  readonly codeSent?: boolean;
}

export interface ProviderCommand {
  readonly description: string;
  run(args: readonly string[], ctx: ProviderContext): Promise<unknown>;
}

export interface Provider {
  readonly id: string;
  readonly title: string;
  readonly secrets: readonly SecretField[];
  readonly commands?: Readonly<Record<string, ProviderCommand>>;

  login?(ask: Ask, ctx: ProviderContext, options: LoginOptions): Promise<void>;

  search?(query: SearchQuery, ctx: ProviderContext): Promise<Page<Product>>;
  product?(id: string, ctx: ProviderContext): Promise<Product>;
  cart?(ctx: ProviderContext): Promise<Cart>;
  setCartItem?(
    productId: string,
    quantity: number,
    ctx: ProviderContext,
  ): Promise<Cart>;
  checkoutPreview?(ctx: ProviderContext): Promise<CheckoutPreview>;
  placeOrder?(preview: CheckoutPreview, ctx: ProviderContext): Promise<Order>;
  orders?(ctx: ProviderContext): Promise<Page<Order>>;
  order?(id: string, ctx: ProviderContext): Promise<Order>;
}

export const capabilityNames = [
  "search",
  "product",
  "cart",
  "setCartItem",
  "checkoutPreview",
  "placeOrder",
  "orders",
  "order",
] as const;

export type Capability = (typeof capabilityNames)[number];

export function capabilities(provider: Provider): Capability[] {
  return capabilityNames.filter((name) => provider[name] !== undefined);
}
