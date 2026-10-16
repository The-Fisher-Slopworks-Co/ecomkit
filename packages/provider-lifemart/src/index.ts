import { EcomError, type Provider, type ProviderContext } from "@ecomkit/core";
import { toProduct, type CatalogItem } from "./catalog.ts";
import {
  addressLine,
  changed,
  lineIndex,
  serviceQuantity,
  savedAddresses,
  toCart,
  type AddressesResponse,
  type CartEntity,
  type ChangeCartResponse,
} from "./cart.ts";
import { toOrder, type OrderEntity, type OrdersResponse } from "./orders.ts";
import { Session, sessionSecrets } from "./session.ts";

const SCREEN_WIDTH = "1080";
const DEFAULT_PAGE_SIZE = 20;
const RECENT_ORDERS = "10";

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

  async function deliveryStore(
    ctx: ProviderContext,
  ): Promise<Record<string, string>> {
    if ((await ctx.secrets.get("accessToken")) === undefined) return {};
    const cart = await session.authorized<CartEntity>(ctx, "GET", "cart", {
      query: { need_update: "false" },
    });
    return cart.delivery_type && cart.cart_department_id && cart.city_id
      ? {
          department: String(cart.cart_department_id),
          city: String(cart.city_id),
        }
      : {};
  }

  async function catalogItem(id: string, ctx: ProviderContext) {
    if (!/^\d+$/.test(id)) {
      throw new EcomError("invalid_input", `Bad Lifemart product id ${id}`);
    }
    const store = await deliveryStore(ctx);
    const item = await get<CatalogItem | null>(
      "services/catalog-api-service/product",
      {
        ...store,
        id,
        brand_id: "2",
        ignore_schedule: "false",
        ignore_stoplist: "0",
        is_mobile: "true",
        language: "ru",
        product_format: "notransform",
        type_delivery: "delivery",
      },
    )(ctx);
    if (item === null || item === undefined) {
      throw new EcomError("not_found", `No Lifemart product ${id}`);
    }
    return item;
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

    product: async (id, ctx) => toProduct(await catalogItem(id, ctx)),

    cart: async (ctx) =>
      toCart(
        await session.authorized<CartEntity>(ctx, "GET", "cart", {
          query: { need_update: "true" },
        }),
      ),

    async setCartItem(productId, quantity, ctx) {
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new EcomError(
          "invalid_input",
          `Quantity must be a non-negative integer, got ${quantity}`,
        );
      }
      const [current, item] = await Promise.all([
        session.authorized<CartEntity>(ctx, "GET", "cart", {
          query: { need_update: "false" },
        }),
        catalogItem(productId, ctx),
      ]);
      if (!current.delivery_type) {
        throw new EcomError(
          "invalid_input",
          "Choose where to deliver first: `ecom lifemart addresses`, then `ecom lifemart address <id>`",
        );
      }
      const cart = changed(
        await session.authorized<ChangeCartResponse>(
          ctx,
          "POST",
          "cart/product",
          {
            body: {
              id: item.id,
              quantity: serviceQuantity(item, quantity),
              idx: lineIndex(current, item.id),
              modifiers: [],
            },
          },
        ),
      );
      return toCart(cart);
    },

    async orders(ctx) {
      const { orders } = await session.authorized<OrdersResponse>(
        ctx,
        "GET",
        "orders/list",
        {
          query: { max_records: RECENT_ORDERS, offset: "0", detailed: "true" },
        },
      );
      return { items: orders.map(toOrder) };
    },

    async order(id, ctx) {
      if (!/^\d+$/.test(id)) {
        throw new EcomError("invalid_input", `Bad Lifemart order id ${id}`);
      }
      const order = await session.authorized<OrderEntity | null>(
        ctx,
        "GET",
        `orders/details/${id}`,
      );
      if (!order) throw new EcomError("not_found", `No Lifemart order ${id}`);
      return toOrder(order);
    },
    commands: {
      addresses: {
        description:
          "List the delivery addresses saved in your Lifemart profile",
        async run(_args, ctx) {
          const response = await session.authorized<AddressesResponse>(
            ctx,
            "GET",
            "address",
          );
          return savedAddresses(response).map((address) => ({
            id: address.id,
            city: address.city,
            address: addressLine(address),
            ...(address.flat ? { apartment: address.flat } : {}),
          }));
        },
      },
      address: {
        description:
          "Deliver the cart to the saved address <id> (see `ecom lifemart addresses`)",
        async run(args, ctx) {
          const [id] = args;
          if (args.length !== 1 || id === undefined || !/^\d+$/.test(id)) {
            throw new EcomError(
              "invalid_input",
              "Usage: ecom lifemart address <id>",
            );
          }
          const response = await session.authorized<AddressesResponse>(
            ctx,
            "GET",
            "address",
          );
          const address = savedAddresses(response).find(
            (candidate) => String(candidate.id) === id,
          );
          if (!address) {
            throw new EcomError("not_found", `No saved Lifemart address ${id}`);
          }
          const cart = changed(
            await session.authorized<ChangeCartResponse>(
              ctx,
              "POST",
              "cart/delivery",
              {
                query: { screen_width: SCREEN_WIDTH },
                body: {
                  city_id: address.city_id,
                  delivery_type: "delivery",
                  delivery_address: address,
                  check_stop: "fail",
                  is_geolocation_allowed: false,
                },
              },
            ),
          );
          return toCart(cart);
        },
      },
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
