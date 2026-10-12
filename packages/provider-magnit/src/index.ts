import {
  EcomError,
  money,
  type Product,
  type Provider,
  type ProviderContext,
} from "@ecomkit/core";
import { Session, sessionSecrets } from "./session.ts";

const API_URL = "https://middle-api.magnit.ru/";
const DEFAULT_PAGE_SIZE = 20;
const STORE_SEARCH_RADIUS_METERS = 3000;
const EXPRESS = { storeType: "express", catalogType: "2" } as const;

interface Good {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
  readonly isMissing?: boolean;
  readonly gallery: readonly { readonly url: string }[];
  readonly promotion: { readonly oldPrice: number | null };
}

interface GoodDetails extends Good {
  readonly details: readonly {
    readonly name: string;
    readonly value?: string;
    readonly parameters: readonly {
      readonly name: string;
      readonly value: string;
    }[];
  }[];
}

interface GoodsSearchResponse {
  readonly items: readonly Good[];
  readonly pagination: { readonly hasMore: boolean };
}

interface StoreRef {
  readonly owner: string;
  readonly storeCode: string;
}

interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

interface StoresSearchResponse {
  readonly items: {
    readonly items: readonly {
      readonly externalId: StoreRef;
      readonly coordinates: Coordinates;
      readonly storeTypeV2: string;
    }[];
  };
}

interface StoreResponse {
  readonly address: string;
}

interface MagnitStore {
  readonly code: string;
  readonly format: string;
  readonly address: string;
  readonly distanceMeters: number;
}

interface MagnitOptions {
  readonly deviceId?: string;
}

export function createMagnitProvider({
  deviceId,
}: MagnitOptions = {}): Provider {
  const session = new Session(deviceId);

  function api(ctx: ProviderContext) {
    const http = ctx.http(API_URL);
    return {
      get: async <T>(path: string, query: Record<string, string>) =>
        http.get<T>(path, { query, headers: await session.headers(ctx) }),
      post: async <T>(path: string, body: unknown) =>
        http.post<T>(path, { body, headers: await session.headers(ctx) }),
    };
  }

  return {
    id: "magnit",
    title: "Magnit delivery (express catalogue of one store)",
    secrets: [
      {
        key: "store",
        label: "Magnit store code, set with `ecom magnit store <code>`",
      },
      ...sessionSecrets,
    ],

    login: (ask, ctx) => session.signIn(ask, ctx),

    async search({ text, limit = DEFAULT_PAGE_SIZE, cursor }, ctx) {
      const offset = parseCursor(cursor);
      const store = await ctx.secrets.require("store");
      const page = await api(ctx).post<GoodsSearchResponse>("v2/goods/search", {
        ...EXPRESS,
        storeCode: store,
        term: text,
        pagination: { limit, offset },
        sort: { order: "desc", type: "relevance" },
      });
      const end = offset + page.items.length;
      return {
        items: page.items.map((good) => toProduct(good, store)),
        ...(page.pagination.hasMore ? { nextCursor: String(end) } : {}),
      };
    },

    async product(id, ctx) {
      const store = await ctx.secrets.require("store");
      const good = await api(ctx).get<GoodDetails>(
        `v2/goods/${encodeURIComponent(id)}/stores/${encodeURIComponent(store)}`,
        { storetype: EXPRESS.storeType, catalogtype: EXPRESS.catalogType },
      );
      const description = good.details.find(
        (detail) => detail.name === "Описание",
      )?.value;
      const brand = good.details
        .flatMap((detail) => detail.parameters)
        .find((parameter) => parameter.name === "Бренд")?.value;
      return {
        ...toProduct(good, store),
        ...(brand ? { brand } : {}),
        ...(description ? { description } : {}),
      };
    },

    commands: {
      store: {
        description: "Use the Magnit store <code> for search, cart and orders",
        async run(args, ctx) {
          const [code] = args;
          if (args.length !== 1 || code === undefined || !/^\d+$/.test(code)) {
            throw new EcomError(
              "invalid_input",
              "Usage: ecom magnit store <code>",
            );
          }
          const store = await api(ctx).post<StoreResponse>(
            "v1/stores-facade/store",
            { externalId: { owner: "OWNER_MAGNIT", storeCode: code } },
          );
          await ctx.secrets.set("store", code);
          return { code, address: store.address };
        },
      },
      stores: {
        description:
          "List Magnit stores that deliver near <lat> <lon>, nearest first",
        async run(args, ctx) {
          const point = parsePoint(args);
          const client = api(ctx);
          const found = await client.post<StoresSearchResponse>(
            "v1/stores-facade/search",
            {
              filters: {
                geo: {
                  typeName: "circle",
                  coordinates: point,
                  distance_meters: STORE_SEARCH_RADIUS_METERS,
                },
                deliveryTypeList: ["DELIVERY_TYPE_DELIVERY"],
              },
            },
          );
          const stores = found.items.items.filter(
            (store) => store.externalId.owner === "OWNER_MAGNIT",
          );
          const described = await Promise.all(
            stores.map(async (store): Promise<MagnitStore> => ({
              code: store.externalId.storeCode,
              format: store.storeTypeV2,
              address: (
                await client.post<StoreResponse>("v1/stores-facade/store", {
                  externalId: store.externalId,
                })
              ).address,
              distanceMeters: Math.round(
                distanceMeters(point, store.coordinates),
              ),
            })),
          );
          return described.toSorted(
            (a, b) => a.distanceMeters - b.distanceMeters,
          );
        },
      },
    },
  };
}

function toProduct(good: Good, store: string): Product {
  const imageUrl = good.gallery[0]?.url;
  const oldPrice = good.promotion.oldPrice;
  const url = new URL(`https://magnit.ru/product/${good.id}`);
  url.search = new URLSearchParams({
    shopCode: store,
    shopType: EXPRESS.storeType,
    catalogType: EXPRESS.catalogType,
  }).toString();
  return {
    id: good.id,
    title: good.name,
    price: money(good.price),
    ...(oldPrice === null || oldPrice <= good.price
      ? {}
      : { oldPrice: money(oldPrice) }),
    url: url.toString(),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    available: good.quantity > 0 && good.isMissing !== true,
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

function parsePoint(args: readonly string[]): Coordinates {
  const [latitude, longitude] = args.map(Number);
  if (
    args.length !== 2 ||
    latitude === undefined ||
    longitude === undefined ||
    !(Math.abs(latitude) <= 90) ||
    !(Math.abs(longitude) <= 180)
  ) {
    throw new EcomError(
      "invalid_input",
      "Usage: ecom magnit stores <latitude> <longitude>",
    );
  }
  return { latitude, longitude };
}

const EARTH_RADIUS_METERS = 6_371_000;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}
