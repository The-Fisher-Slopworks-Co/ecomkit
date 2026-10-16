import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  createHttpClient,
  envSecretStore,
  money,
  providerSecrets,
  type Provider,
  type ProviderContext,
} from "@ecomkit/core";
import { createLifemartProvider } from "./index.ts";

const FIXTURES = new URL("../../../fixtures/lifemart/", import.meta.url);
const DEVICE_ID = "8d2f6a41-7c3e-4b9a-a1d5-0e6f2b7c9a13";

interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: unknown;
}

type Overrides = Readonly<Record<string, unknown>>;

function fixtureFile(method: string, url: URL): string | null {
  if (method === "GET" && url.pathname === "/api/menu/search") {
    return "menu-search.json";
  }
  if (
    method === "GET" &&
    url.pathname === "/api/services/catalog-api-service/product"
  ) {
    const id = url.searchParams.get("id");
    return id === "25423" || id === "25038" ? `product-${id}.json` : null;
  }
  if (method === "GET" && url.pathname === "/api/cart") return "cart.json";
  if (method === "GET" && url.pathname === "/api/user/profile") {
    return "user-profile.json";
  }
  if (method === "POST" && url.pathname === "/api/cart/send") {
    return "cart-send.json";
  }
  if (method === "GET" && url.pathname === "/api/address") {
    return "address.json";
  }
  if (method === "POST" && url.pathname === "/api/cart/product") {
    return "cart-product.json";
  }
  if (method === "POST" && url.pathname === "/api/cart/promocode") {
    return "cart-promocode.json";
  }
  if (method === "POST" && url.pathname === "/api/cart/delivery") {
    return "cart-delivery.json";
  }
  if (method === "GET" && url.pathname === "/api/orders/list") {
    return "orders-list.json";
  }
  const order = /^\/api\/orders\/details\/(\d+)$/.exec(url.pathname);
  if (method === "GET" && order) {
    return order[1] === "100000002" || order[1] === "100000003"
      ? `order-${order[1]}.json`
      : null;
  }
  throw new Error(`No fixture for ${method} ${url.href}`);
}

function setup(
  overrides: Overrides = {},
  env: Record<string, string> = { ECOM_LIFEMART_ACCESSTOKEN: "access-1" },
) {
  const requests: Recorded[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    requests.push({
      method,
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const override = overrides[`${method} ${url.pathname}`];
    const file = override === undefined ? fixtureFile(method, url) : null;
    const body =
      override !== undefined
        ? JSON.stringify(override)
        : file === null
          ? "null"
          : await readFile(new URL(file, FIXTURES), "utf8");
    return new Response(body, {
      headers: { "content-type": "application/json" },
    });
  };
  const ctx: ProviderContext = {
    secrets: providerSecrets(envSecretStore(env), "lifemart"),
    http: (baseUrl) => createHttpClient({ baseUrl, fetch }),
  };
  return {
    lifemart: createLifemartProvider({ deviceId: DEVICE_ID }),
    ctx,
    requests,
  };
}

function required<K extends keyof Provider>(provider: Provider, key: K) {
  const method = provider[key];
  if (method === undefined) throw new Error(`lifemart lacks ${key}`);
  return method;
}

describe("lifemart provider", () => {
  test("pages through the whole search result on the client", async () => {
    const { lifemart, ctx, requests } = setup();

    const first = await required(lifemart, "search")(
      { text: "молоко", limit: 2 },
      ctx,
    );
    const second = await required(lifemart, "search")(
      { text: "молоко", limit: 2, cursor: first.nextCursor ?? "" },
      ctx,
    );

    expect(first.items.map((product) => product.id)).toEqual(["25423", "7571"]);
    expect(first.nextCursor).toBe("2");
    expect(second.items.map((product) => product.id)).toEqual([
      "22241",
      "25038",
    ]);
    expect(second.nextCursor).toBeUndefined();
    expect(requests[0]?.url.searchParams.get("query")).toBe("молоко");
    expect(requests[0]?.headers.get("uuid")).toBe(DEVICE_ID);
    expect(requests[0]?.headers.get("app-version")).toBe("1.68.0");
  });

  test("converts ruble prices to kopecks and keeps a discount", async () => {
    const { lifemart, ctx } = setup();

    const { items } = await required(lifemart, "search")(
      { text: "молоко" },
      ctx,
    );

    expect(items[0]).toMatchObject({
      title: "Молоко 2,5%, Талицкое",
      price: money(10900),
      oldPrice: money(12500),
      available: true,
      url: "https://lifemart.ru/product/25423",
    });
    expect(items[1]?.oldPrice).toBeUndefined();
    expect(items[2]?.available).toBe(false);
  });

  test("prices a weighted good per step and names the step", async () => {
    const { lifemart, ctx } = setup();

    const { items } = await required(lifemart, "search")(
      { text: "молоко" },
      ctx,
    );

    expect(items[3]).toMatchObject({
      id: "25038",
      title: "Бананы, 200 г",
      price: money(3420),
    });
  });

  test("reads a product card with its composition", async () => {
    const { lifemart, ctx } = setup();

    const product = await required(lifemart, "product")("25423", ctx);

    expect(product).toMatchObject({
      id: "25423",
      price: money(10900),
      description: "нормализованное молоко",
    });
  });

  test("reports a missing product as not found", async () => {
    const { lifemart, ctx } = setup();

    expect(required(lifemart, "product")("99999999", ctx)).rejects.toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });

  test("lists recent orders with the access token", async () => {
    const { lifemart, ctx, requests } = setup();

    const { items } = await required(lifemart, "orders")(ctx);

    expect(items.map((order) => [order.id, order.status])).toEqual([
      ["100000002", "delivering"],
      ["100000001", "cancelled"],
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe("access-1");
    expect(requests[0]?.url.searchParams.get("max_records")).toBe("10");
    expect(items[1]?.address).toEqual({
      line: "улица Малышева, 1",
      city: "Екатеринбург",
      comment: "pickup",
    });
  });

  test("reads an order with its items and address", async () => {
    const { lifemart, ctx } = setup();

    const order = await required(lifemart, "order")("100000002", ctx);

    expect(order).toMatchObject({
      createdAt: "2026-01-02T05:00:00.000Z",
      total: money(14320),
      address: {
        line: "улица Ленина, 1",
        city: "Екатеринбург",
        apartment: "кв. 1",
      },
    });
    expect(order.items).toEqual([
      expect.objectContaining({ quantity: 2, total: money(10900) }),
      expect.objectContaining({
        product: expect.objectContaining({
          title: "Бананы, 200 г",
          price: money(3420),
        }),
        quantity: 1,
        total: money(3420),
      }),
    ]);
  });

  test("keeps an order with an unknown status in progress", async () => {
    const { lifemart, ctx } = setup();

    const order = await required(lifemart, "order")("100000002", ctx);

    expect(order.status).toBe("in_progress");
  });

  test("reports a missing order as not found", async () => {
    const { lifemart, ctx } = setup();

    await expect(required(lifemart, "order")("100000009", ctx)).rejects.toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });

  test("reads the cart in steps and marks lines out of stock", async () => {
    const { lifemart, ctx } = setup();

    const cart = await required(lifemart, "cart")(ctx);

    expect(cart.items).toEqual([
      expect.objectContaining({ quantity: 2, total: money(18800) }),
      expect.objectContaining({
        product: expect.objectContaining({
          title: "Бананы, 200 г",
          price: money(3420),
          available: false,
        }),
        quantity: 2,
        total: money(6840),
      }),
    ]);
    expect(cart).toMatchObject({
      subtotal: money(25640),
      delivery: money(9900),
      total: money(35540),
    });
  });

  test("sets a weighted item in kilograms on its own line", async () => {
    const { lifemart, ctx, requests } = setup();

    await required(lifemart, "setCartItem")("25038", 3, ctx);

    const post = requests.find((r) => r.url.pathname === "/api/cart/product");
    expect(post?.body).toEqual({
      id: 25038,
      quantity: 0.6,
      idx: 3,
      modifiers: [],
    });
  });

  test("puts a new item on the next free line", async () => {
    const { lifemart, ctx, requests } = setup();

    await required(lifemart, "setCartItem")("25423", 1, ctx);

    const post = requests.find((r) => r.url.pathname === "/api/cart/product");
    expect(post?.body).toMatchObject({ id: 25423, quantity: 1, idx: 4 });
  });

  test("asks to choose a delivery address before filling the cart", async () => {
    const { lifemart, ctx } = setup({
      "GET /api/cart": { products: [], total_amount: 0, delivery_type: null },
    });

    await expect(
      required(lifemart, "setCartItem")("25423", 1, ctx),
    ).rejects.toThrow("ecom lifemart address <id>");
  });

  test("passes on a change the store refuses", async () => {
    const { lifemart, ctx } = setup({
      "POST /api/cart/product": {
        success: false,
        error_message: "Нельзя добавить больше, чем есть в магазине",
      },
    });

    await expect(
      required(lifemart, "setCartItem")("25423", 9, ctx),
    ).rejects.toThrow("Нельзя добавить больше, чем есть в магазине");
  });

  test("lists saved addresses and delivers the cart to one", async () => {
    const { lifemart, ctx, requests } = setup();
    const commands = lifemart.commands ?? {};

    const listed = await commands["addresses"]?.run([], ctx);
    await commands["address"]?.run(["1000001"], ctx);

    expect(listed).toEqual([
      {
        id: 1000001,
        city: "Екатеринбург",
        address: "улица Ленина, 1",
        apartment: "1",
      },
    ]);
    const post = requests.find((r) => r.url.pathname === "/api/cart/delivery");
    expect(post?.url.searchParams.get("screen_width")).toBe("1080");
    expect(post?.body).toMatchObject({
      city_id: 1,
      delivery_type: "delivery",
      delivery_address: { id: 1000001, street: "улица Ленина", flat: "1" },
      check_stop: "fail",
    });
  });

  test("applies a promo code and shows the discount", async () => {
    const { lifemart, ctx, requests } = setup();

    const cart = await lifemart.commands?.["promo"]?.run([" sale10 "], ctx);

    expect(
      requests.find((r) => r.url.pathname === "/api/cart/promocode")?.body,
    ).toEqual({ promocode: "sale10" });
    expect(cart).toMatchObject({
      subtotal: money(18_800),
      discount: money(1_880),
      delivery: money(9_900),
      total: money(26_820),
    });
  });

  test("passes on a promo code the service rejects", async () => {
    const { lifemart, ctx } = setup({
      "POST /api/cart/promocode": {
        success: false,
        error_message: "Промокод введен некорректно, попробуйте еще раз",
      },
    });

    await expect(
      lifemart.commands?.["promo"]?.run(["WRONG"], ctx),
    ).rejects.toThrow("Промокод введен некорректно");
  });

  test("passes on a promo code that does not fit the cart", async () => {
    const { lifemart, ctx } = setup({
      "POST /api/cart/promocode": {
        success: true,
        cart: {
          products: [],
          total_amount: 0,
          promoevents: [
            {
              promocode: "SALE10",
              error_message: "Минимальная сумма заказа 1000 ₽",
            },
          ],
        },
      },
    });

    await expect(
      lifemart.commands?.["promo"]?.run(["sale10"], ctx),
    ).rejects.toThrow(
      "Lifemart did not apply sale10: Минимальная сумма заказа",
    );
  });

  test("refuses an address that is not saved", async () => {
    const { lifemart, ctx } = setup();

    await expect(
      lifemart.commands?.["address"]?.run(["42"], ctx),
    ).rejects.toThrow(expect.objectContaining({ code: "not_found" }));
  });

  test("checks a product card against the store of the cart", async () => {
    const { lifemart, ctx, requests } = setup({
      "GET /api/cart": {
        products: [],
        total_amount: 0,
        delivery_type: "delivery",
        cart_department_id: 42,
        city_id: 1,
      },
    });

    await required(lifemart, "product")("25423", ctx);

    const card = requests.find((r) => r.url.pathname.endsWith("/product"));
    expect(card?.url.searchParams.get("department")).toBe("42");
    expect(card?.url.searchParams.get("city")).toBe("1");
    expect(card?.url.searchParams.get("ignore_stoplist")).toBe("0");
  });

  test("reads a product card of the whole network before sign-in", async () => {
    const { lifemart, ctx, requests } = setup({}, {});

    await required(lifemart, "product")("25423", ctx);

    expect(requests.map((r) => r.url.pathname)).toEqual([
      "/api/services/catalog-api-service/product",
    ]);
    expect(requests[0]?.url.searchParams.has("department")).toBe(false);
  });

  test("places a confirmed order paid by SBP", async () => {
    const checkoutCart = await fixtureJson("cart-checkout.json");
    const { lifemart, ctx, requests } = setup({
      "GET /api/cart": checkoutCart,
    });
    const preview = await required(lifemart, "checkoutPreview")(ctx);

    const order = await required(lifemart, "placeOrder")(preview, ctx);

    const send = requests.find((r) => r.url.pathname === "/api/cart/send");
    expect(send?.body).toMatchObject({
      payment_info: { type: "online", online: { type: "qr" } },
      user_data: { email: "buyer@example.com" },
    });
    expect(order).toMatchObject({
      id: "100000003",
      status: "created",
      paymentUrl: "https://qr.nspk.ru/AS1000000000000000000000000000000",
    });
  });

  test("refuses an order that changed after confirmation", async () => {
    const checkoutCart = await fixtureJson("cart-checkout.json");
    const { lifemart, ctx, requests } = setup({
      "GET /api/cart": checkoutCart,
    });
    const preview = await required(lifemart, "checkoutPreview")(ctx);

    await expect(
      required(lifemart, "placeOrder")({ ...preview, payment: "cash" }, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: "confirmation_required" }),
    );
    expect(requests.some((r) => r.url.pathname === "/api/cart/send")).toBe(
      false,
    );
  });

  test("returns the placed order when reading it back fails", async () => {
    const checkoutCart = await fixtureJson("cart-checkout.json");
    const { lifemart, ctx } = setup({
      "GET /api/cart": checkoutCart,
      "POST /api/cart/send": {
        success: true,
        order_id: 100000009,
        payment_url: "https://pay.example.com/form/9",
      },
    });
    const preview = await required(lifemart, "checkoutPreview")(ctx);

    const order = await required(lifemart, "placeOrder")(preview, ctx);

    expect(order).toMatchObject({
      id: "100000009",
      status: "created",
      total: preview.total,
      paymentUrl: "https://pay.example.com/form/9",
    });
  });
});

async function fixtureJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
}
