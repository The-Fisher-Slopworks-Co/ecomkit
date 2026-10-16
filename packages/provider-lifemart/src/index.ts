import { EcomError, type Provider, type ProviderContext } from "@ecomkit/core";
import { toProduct, type CatalogItem } from "./catalog.ts";
import { Session, sessionSecrets } from "./session.ts";

const SCREEN_WIDTH = "1080";
const DEFAULT_PAGE_SIZE = 20;

interface LifemartOptions {
  readonly deviceId?: string;
}

export function createLifemartProvider({
  deviceId,
}: LifemartOptions = {}): Provider {
  const session = new Session(deviceId);

  function get<T>(path: string, query: Record<string, string>) {
    return (ctx: ProviderContext) =>
      session.request<T>(ctx, "GET", path, { query });
  }

  return {
    id: "lifemart",
    title: "Lifemart (Жизньмарт) delivery",
    secrets: sessionSecrets,

    login: (ask, ctx, options) => session.signIn(ask, ctx, options),

    async search({ text, limit = DEFAULT_PAGE_SIZE, cursor }, ctx) {
      const offset = parseCursor(cursor);
      const { products } = await get<{ products: readonly CatalogItem[] }>(
        "menu/search",
        { query: text, screen_width: SCREEN_WIDTH },
      )(ctx);
      const end = offset + limit;
      return {
        items: products.slice(offset, end).map(toProduct),
        ...(end < products.length ? { nextCursor: String(end) } : {}),
      };
    },

    async product(id, ctx) {
      if (!/^\d+$/.test(id)) {
        throw new EcomError("invalid_input", `Bad Lifemart product id ${id}`);
      }
      const item = await get<CatalogItem | null>(
        "services/catalog-api-service/product",
        { id, is_mobile: "true", language: "ru" },
      )(ctx);
      if (item === null || item === undefined) {
        throw new EcomError("not_found", `No Lifemart product ${id}`);
      }
      return toProduct(item);
    },
  };
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new EcomError("invalid_input", `Bad cursor ${cursor}`);
  }
  return offset;
}
