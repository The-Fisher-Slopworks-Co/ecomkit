import { randomUUID } from "node:crypto";
import { EcomError, type Provider, type ProviderContext } from "@ecomkit/core";
import { toProduct, type CatalogItem } from "./catalog.ts";

const API_URL = "https://api.lifemart.ru/api/";
const APP_VERSION = "1.68.0";
const SCREEN_WIDTH = "1080";
const DEFAULT_PAGE_SIZE = 20;

interface LifemartOptions {
  readonly deviceId?: string;
}

export function createLifemartProvider({
  deviceId = randomUUID(),
}: LifemartOptions = {}): Provider {
  function get<T>(path: string, query: Record<string, string>) {
    return (ctx: ProviderContext) =>
      ctx.http(API_URL).get<T>(path, {
        query,
        headers: {
          uuid: deviceId,
          "app-version": APP_VERSION,
          "x-platform": "Android",
          "content-language": "ru",
          "user-agent": "okhttp/4.12.0",
        },
      });
  }

  return {
    id: "lifemart",
    title: "Lifemart (Жизньмарт) delivery",
    secrets: [],

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
