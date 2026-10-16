import {
  EcomError,
  previewDigest,
  type Order,
  type Provider,
  type ProviderContext,
} from "@ecomkit/core";
import { toProduct, type CatalogItem } from "./catalog.ts";
import {
  addressLine,
  changed,
  lineIndex,
  promocodeApplied,
  serviceQuantity,
  savedAddresses,
  toCart,
  type AddressesResponse,
  type CartEntity,
  type ChangeCartResponse,
} from "./cart.ts";
import {
  createdOrderId,
  orderRequest,
  paymentLink,
  toCheckoutPreview,
  type CheckoutCart,
  type OrderCreated,
  type Profile,
} from "./checkout.ts";
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

  async function checkout(ctx: ProviderContext) {
    const [cart, profile] = await Promise.all([
      session.authorized<CheckoutCart>(ctx, "GET", "cart", {
        query: { need_update: "true" },
      }),
      session.authorized<Profile>(ctx, "GET", "user/profile"),
    ]);
    return { cart, profile, preview: toCheckoutPreview(cart, profile) };
  }

  async function orderById(id: string, ctx: ProviderContext) {
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
    notes: [
      "Search and product cards work without signing in. Food shows nutrition: per serving in search, per serving and per 100 g on the card, totals in the cart, and in the `nutrition` field under --json.",
      "Sign in with an SMS code. `ecom login lifemart --code` takes a code that was already sent, e.g. after an interrupted entry or one requested on lifemart.ru. If Lifemart asks for a captcha, request the code on the site and enter it this way: ecom does not solve captchas.",
      "`orders` lists the last 10 orders.",
      "The cart is bound to the device, so ecom has its own cart, not the one in the app. The store and stock depend on the delivery address: pick one of the profile's saved addresses with `ecom lifemart addresses` and `ecom lifemart address <id>`. Until then search and cards show stock across the whole chain.",
      'Weighted goods are sold in steps named with their weight, priced per step: "Бананы, 200 г" costs 200 g of bananas and `--qty 2` puts 400 g in the cart.',
      "`promo <code>` applies to ecom's cart; the discount shows in the cart and the checkout preview, and a rejected code comes with Lifemart's explanation.",
      "Checkout delivers to the chosen address at the nearest time and is paid by SBP through the payment link it returns. The order gets its number only after payment, then it appears in `orders`. Online payment needs an email in the profile. A cart below the minimum sum, with an unavailable item or with a fee is not ordered.",
    ],
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

    order: orderById,

    checkoutPreview: async (ctx) => (await checkout(ctx)).preview,

    async placeOrder(confirmed, ctx) {
      const { cart, profile, preview } = await checkout(ctx);
      if (previewDigest(preview) !== previewDigest(confirmed)) {
        throw new EcomError(
          "confirmation_required",
          "The order changed after it was confirmed; run checkout again",
        );
      }
      const created = await session.authorized<OrderCreated>(
        ctx,
        "POST",
        "cart/send",
        { body: orderRequest(cart, profile) },
      );
      const id = createdOrderId(created);
      const fromPreview = (orderId: string): Order => ({
        id: orderId,
        status: "created",
        createdAt: new Date().toISOString(),
        items: preview.items,
        total: preview.total,
        ...(preview.address ? { address: preview.address } : {}),
        ...paymentLink(created),
      });
      if (typeof id === "string") return fromPreview(id);
      try {
        return {
          ...(await orderById(String(id), ctx)),
          ...paymentLink(created),
        };
      } catch {
        return fromPreview(String(id));
      }
    },
    commands: {
      promo: {
        description: "Apply the promo code <code> to the cart",
        async run(args, ctx) {
          const [code] = args;
          if (args.length !== 1 || !code?.trim()) {
            throw new EcomError(
              "invalid_input",
              "Usage: ecom lifemart promo <code>",
            );
          }
          const cart = changed(
            await session.authorized<ChangeCartResponse>(
              ctx,
              "POST",
              "cart/promocode",
              { body: { promocode: code.trim() } },
            ),
          );
          return toCart(promocodeApplied(cart, code.trim()));
        },
      },
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
