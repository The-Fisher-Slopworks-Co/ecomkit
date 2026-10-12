import {
  EcomError,
  money,
  previewDigest,
  type Product,
  type Provider,
  type ProviderContext,
} from "@ecomkit/core";
import {
  EXPRESS,
  deliveryStore,
  productUrl,
  toCart,
  weightedTitle,
  type CheckoutPreviewResponse,
} from "./cart.ts";
import {
  checkoutCartId,
  orderRequest,
  toCheckoutPreview,
  type CheckoutResponse,
} from "./checkout.ts";
import {
  toOrder,
  type OrderInfoResponse,
  type OrdersListResponse,
} from "./orders.ts";
import { Session, sessionSecrets } from "./session.ts";

const API_URL = "https://middle-api.magnit.ru/";
const DEFAULT_PAGE_SIZE = 20;
const STORE_SEARCH_RADIUS_METERS = 3000;
const RECENT_ORDERS = 10;

interface Good {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
  readonly isMissing?: boolean;
  readonly gallery: readonly { readonly url: string }[];
  readonly promotion: { readonly oldPrice: number | null };
  readonly weighted?: {
    readonly isWeighted: boolean;
    readonly step: number | null;
  };
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

  async function preview(ctx: ProviderContext) {
    const store = await ctx.secrets.require("store");
    return session.authorized(ctx, (headers) =>
      ctx.http(API_URL).get<CheckoutPreviewResponse>("v1/checkout/preview", {
        headers: { ...headers, ...checkoutHeaders(store) },
      }),
    );
  }

  async function checkout(ctx: ProviderContext) {
    const cart = await preview(ctx);
    const cartId = checkoutCartId(cart);
    const details = await session.authorized(ctx, (headers) =>
      ctx
        .http(API_URL)
        .get<CheckoutResponse>(`v1/checkout/${encodeURIComponent(cartId)}`, {
          headers: { ...headers, ...checkoutHeaders(deliveryStore(cart)) },
        }),
    );
    return {
      cartId,
      store: deliveryStore(cart),
      details,
      preview: toCheckoutPreview(cart, details),
    };
  }

  function api(ctx: ProviderContext) {
    const http = ctx.http(API_URL);
    return {
      get: async <T>(path: string, query: Record<string, string>) =>
        http.get<T>(path, { query, headers: await session.headers(ctx) }),
      post: async <T>(path: string, body: unknown) =>
        http.post<T>(path, { body, headers: await session.headers(ctx) }),
    };
  }

  function authorizedGet<T>(
    path: string,
    ctx: ProviderContext,
    query: Record<string, string> = {},
  ) {
    return session.authorized(ctx, (headers) =>
      ctx.http(API_URL).get<T>(path, { query, headers }),
    );
  }

  function orderInfo(id: string, ctx: ProviderContext) {
    return authorizedGet<OrderInfoResponse>(
      `v2/orders/info/${encodeURIComponent(id)}`,
      ctx,
    );
  }

  function goodDetails(id: string, store: string, ctx: ProviderContext) {
    return api(ctx).get<GoodDetails>(
      `v2/goods/${encodeURIComponent(id)}/stores/${encodeURIComponent(store)}`,
      { storetype: EXPRESS.storeType, catalogtype: EXPRESS.catalogType },
    );
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

    async login(ask, ctx, options) {
      await session.signIn(ask, ctx, options);
      if ((await ctx.secrets.get("store")) === undefined) return;
      const store = (await preview(ctx)).deliveryInfo?.store?.storeCode;
      if (store) await ctx.secrets.set("store", store);
    },

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
      const good = await goodDetails(id, store, ctx);
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

    cart: async (ctx) => toCart(await preview(ctx)),

    async setCartItem(productId, quantity, ctx) {
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new EcomError(
          "invalid_input",
          `Quantity must be a non-negative integer, got ${quantity}`,
        );
      }
      const store = deliveryStore(await preview(ctx));
      const qnty =
        quantity === 0
          ? 0
          : quantity *
            (portionGrams(await goodDetails(productId, store, ctx)) ?? 1);
      await session.authorized(ctx, (headers) =>
        ctx.http(API_URL).request("PUT", "v2/carts/lite", {
          headers,
          query: { service: EXPRESS.storeType, storeCode: store },
          body: {
            items: [
              {
                goodId: productId,
                qnty,
                goodService: EXPRESS.storeType,
                goodStoreCode: store,
              },
            ],
          },
        }),
      );
      return toCart(await preview(ctx));
    },

    checkoutPreview: async (ctx) => (await checkout(ctx)).preview,

    async placeOrder(confirmed, ctx) {
      const { cartId, store, details, preview: current } = await checkout(ctx);
      if (previewDigest(current) !== previewDigest(confirmed)) {
        throw new EcomError(
          "confirmation_required",
          "The order changed after it was confirmed; run checkout again",
        );
      }
      const placed = await session.authorized(ctx, (headers) =>
        ctx.http(API_URL).post<{
          orderNumber: string;
        }>(`v1/checkout/${encodeURIComponent(cartId)}/order`, {
          headers: { ...headers, ...checkoutHeaders(store) },
          body: orderRequest(details),
        }),
      );
      try {
        return toOrder(await orderInfo(placed.orderNumber, ctx));
      } catch {
        return {
          id: placed.orderNumber,
          status: "created",
          createdAt: new Date().toISOString(),
          items: current.items,
          total: current.total,
          ...(current.address ? { address: current.address } : {}),
        };
      }
    },

    async orders(ctx) {
      const [active, history] = await Promise.all([
        authorizedGet<OrdersListResponse>("v2/orders/active/list", ctx),
        authorizedGet<OrdersListResponse>("v2/orders/history/list", ctx, {
          limit: String(RECENT_ORDERS),
          page: "1",
        }),
      ]);
      const ids = [
        ...new Set(
          [...active.items, ...history.items].map((order) => order.orderId),
        ),
      ].slice(0, RECENT_ORDERS);
      const infos = await Promise.all(ids.map((id) => orderInfo(id, ctx)));
      return { items: infos.map(toOrder) };
    },

    order: async (id, ctx) => toOrder(await orderInfo(id, ctx)),

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
  const grams = portionGrams(good);
  return {
    id: good.id,
    title: grams === undefined ? good.name : weightedTitle(good.name, grams),
    price: money(good.price),
    ...(oldPrice === null || oldPrice <= good.price
      ? {}
      : { oldPrice: money(oldPrice) }),
    url: productUrl(good.id, store),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    available: good.quantity > 0 && good.isMissing !== true,
  };
}

function checkoutHeaders(store: string) {
  return {
    "x-service": EXPRESS.storeType,
    "x-store-code": store,
    "x-delivery-type": "delivery",
  };
}

function portionGrams(good: Good): number | undefined {
  return good.weighted?.isWeighted
    ? (good.weighted.step ?? undefined)
    : undefined;
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
