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
import { createMagnitProvider } from "./index.ts";

const FIXTURES = new URL("../../../fixtures/magnit/", import.meta.url);
const DEVICE_ID = "3f1b9c2e-5d7a-4e8b-9c0d-1a2b3c4d5e6f";

interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: unknown;
}

function fixtureFile(method: string, url: URL, body: unknown): string {
  if (method === "POST" && url.pathname === "/v2/goods/search") {
    return "goods-search.json";
  }
  if (method === "POST" && url.pathname === "/v1/stores-facade/search") {
    return "stores-search.json";
  }
  if (method === "POST" && url.pathname === "/v1/stores-facade/store") {
    const { externalId } = body as { externalId: { storeCode: string } };
    return `store-${externalId.storeCode}.json`;
  }
  if (method === "GET" && url.pathname === "/v1/checkout/preview") {
    return "checkout-preview.json";
  }
  if (method === "GET" && url.pathname === "/v1/checkout/cart-1.express") {
    return "checkout-cart.json";
  }
  if (
    method === "POST" &&
    url.pathname === "/v1/checkout/cart-1.express/order"
  ) {
    return "checkout-order.json";
  }
  if (method === "PUT" && url.pathname === "/v2/carts/lite") {
    return "carts-lite.json";
  }
  if (method === "GET" && url.pathname === "/v2/orders/active/list") {
    return "orders-active.json";
  }
  if (method === "GET" && url.pathname === "/v2/orders/history/list") {
    return "orders-history.json";
  }
  const order = /^\/v2\/orders\/info\/([\w-]+)$/.exec(url.pathname);
  if (method === "GET" && order) return `order-${order[1]}.json`;
  const good = /^\/v2\/goods\/(\d+)\/stores\/\d+$/.exec(url.pathname);
  if (method === "GET" && good) return `goods-${good[1]}.json`;
  throw new Error(`No fixture for ${method} ${url.href}`);
}

function setup(env: Record<string, string> = { ECOM_MAGNIT_STORE: "777885" }) {
  const requests: Recorded[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, url, headers: new Headers(init?.headers), body });
    const file = new URL(fixtureFile(method, url, body), FIXTURES);
    return new Response(await readFile(file, "utf8"), {
      headers: { "content-type": "application/json" },
    });
  };
  const ctx: ProviderContext = {
    secrets: providerSecrets(envSecretStore(env), "magnit"),
    http: (baseUrl) => createHttpClient({ baseUrl, fetch }),
  };
  return {
    magnit: createMagnitProvider({ deviceId: DEVICE_ID }),
    ctx,
    requests,
  };
}

function required<K extends keyof Provider>(provider: Provider, key: K) {
  const method = provider[key];
  if (method === undefined) throw new Error(`magnit lacks ${key}`);
  return method;
}

describe("magnit provider", () => {
  test("searches the express catalogue of the chosen store", async () => {
    const { magnit, ctx, requests } = setup();

    const page = await required(magnit, "search")(
      { text: "молоко", limit: 3, cursor: "6" },
      ctx,
    );

    expect(page.items.map((product) => product.id)).toEqual([
      "1000049786",
      "1000127183",
      "1899800733",
    ]);
    expect(page.items[0]).toMatchObject({
      title: "Молоко Северная долина ультрапастеризованное 3.2% 950г",
      price: money(12499),
      available: true,
      url: "https://magnit.ru/product/1000049786?shopCode=777885&shopType=express&catalogType=2",
    });
    expect(page.items[0]?.oldPrice).toBeUndefined();
    expect(page.nextCursor).toBe("9");

    const [request] = requests;
    expect(request?.url.href).toBe(
      "https://middle-api.magnit.ru/v2/goods/search",
    );
    expect(request?.headers.get("x-device-id")).toBe(DEVICE_ID);
    expect(request?.headers.get("x-app-version")).toBe("8.124.0");
    expect(request?.body).toMatchObject({
      storeCode: "777885",
      storeType: "express",
      catalogType: "2",
      term: "молоко",
      pagination: { limit: 3, offset: 6 },
    });
  });

  test("reads brand and description from the product card", async () => {
    const { magnit, ctx, requests } = setup();

    const product = await required(magnit, "product")("1000049786", ctx);

    expect(product).toMatchObject({
      id: "1000049786",
      brand: "Северная Долина",
      price: money(12499),
      available: true,
    });
    expect(product.description).toStartWith("Натуральный продукт");
    expect(requests[0]?.url.search).toBe("?storetype=express&catalogtype=2");
  });

  test("asks for a store before searching", async () => {
    const { magnit, ctx } = setup({});

    await expect(
      required(magnit, "search")({ text: "молоко" }, ctx),
    ).rejects.toMatchObject({ code: "auth_required" });
  });

  test("rejects a malformed cursor", async () => {
    const { magnit, ctx } = setup();

    await expect(
      required(magnit, "search")({ text: "молоко", cursor: "-1" }, ctx),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("lists delivering stores nearest first with their addresses", async () => {
    const { magnit, ctx, requests } = setup({});
    const stores = magnit.commands?.["stores"];
    if (stores === undefined) throw new Error("magnit lacks stores");

    const listed = (await stores.run(["55.7539", "37.6208"], ctx)) as {
      code: string;
      address: string;
      distanceMeters: number;
    }[];

    expect(listed.map((store) => store.code)).toEqual([
      "201697",
      "777885",
      "707942",
      "774946",
      "847319",
    ]);
    expect(listed[0]?.address).toBe("г Москва, ул Новый Арбат, д 11 стр 1");
    expect(listed.map((store) => store.distanceMeters)).toEqual(
      listed.map((store) => store.distanceMeters).toSorted((a, b) => a - b),
    );
    expect(requests[0]?.body).toMatchObject({
      filters: {
        geo: { coordinates: { latitude: 55.7539, longitude: 37.6208 } },
        deliveryTypeList: ["DELIVERY_TYPE_DELIVERY"],
      },
    });
  });

  test("remembers a store after checking that it exists", async () => {
    const { magnit, ctx, requests } = setup({});
    const saved = new Map<string, string>();
    const writable = {
      ...ctx,
      secrets: {
        ...ctx.secrets,
        set: async (key: string, value: string) => {
          saved.set(key, value);
        },
      },
    };

    const chosen = await magnit.commands?.["store"]?.run(["777885"], writable);

    expect(chosen).toEqual({
      code: "777885",
      address: "г Москва, ул Большая Татарская, д 36",
    });
    expect(saved.get("store")).toBe("777885");
    expect(requests[0]?.body).toEqual({
      externalId: { owner: "OWNER_MAGNIT", storeCode: "777885" },
    });
  });

  test("reads the cart of the signed-in account", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });

    const cart = await required(magnit, "cart")(ctx);

    expect(cart.items).toHaveLength(3);
    expect(requests[0]?.headers.get("authorization")).toBe("bearer t");
    expect(requests[0]?.headers.get("x-service")).toBe("express");
    expect(requests[0]?.headers.get("x-store-code")).toBe("777885");
  });

  test("sets an absolute quantity in the delivery store's cart", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });

    await required(magnit, "setCartItem")("1000049786", 3, ctx);

    const put = requests.find((request) => request.method === "PUT");
    expect(put?.url.search).toBe("?service=express&storeCode=777885");
    expect(put?.body).toEqual({
      items: [
        {
          goodId: "1000049786",
          qnty: 3,
          goodService: "express",
          goodStoreCode: "777885",
        },
      ],
    });
    await expect(
      required(magnit, "setCartItem")("1000049786", 1.5, ctx),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("counts a weighted good in shelf portions", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });

    const product = await required(magnit, "product")("1000078228", ctx);
    await required(magnit, "setCartItem")("1000078228", 2, ctx);

    expect(product.title).toBe("Десерт глазированный Акконд Ломтишка, 300 г");
    const put = requests.find((request) => request.method === "PUT");
    expect(put?.body).toMatchObject({ items: [{ qnty: 600 }] });
  });

  test("removes a good without reading its card", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });

    await required(magnit, "setCartItem")("1000078228", 0, ctx);

    expect(requests.map((request) => request.url.pathname)).not.toContain(
      "/v2/goods/1000078228/stores/777885",
    );
    const put = requests.find((request) => request.method === "PUT");
    expect(put?.body).toMatchObject({ items: [{ qnty: 0 }] });
  });

  test("previews the order with its delivery time and payment", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });

    const preview = await required(magnit, "checkoutPreview")(ctx);

    expect(preview).toMatchObject({
      provider: "magnit",
      total: money(103927),
      payment: "Новый СБП",
      address: { line: "Москва, Тверская улица, 1", apartment: "1" },
      deliveryWindow: {
        from: "2026-10-13T09:00:00+03:00",
        to: "2026-10-13T10:00:00+03:00",
      },
    });
    const opened = requests.find(
      (request) => request.url.pathname === "/v1/checkout/cart-1.express",
    );
    expect(opened?.headers.get("x-store-code")).toBe("777885");
    expect(opened?.headers.get("x-service")).toBe("express");
  });

  test("places the confirmed order with the chosen slot and payment", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });
    const preview = await required(magnit, "checkoutPreview")(ctx);

    const order = await required(magnit, "placeOrder")(preview, ctx);

    expect(order).toMatchObject({
      id: "fy-CM000000003",
      status: "created",
      paymentUrl: "https://pay.example.com/order/fy-CM000000003",
    });
    const placed = requests.find((request) => request.method === "POST");
    expect(placed?.headers.get("x-delivery-type")).toBe("delivery");
    expect(placed?.body).toEqual({
      customer: {
        email: "buyer@example.com",
        name: "Покупатель",
        phone: "79990000000",
      },
      deliveryTimeSlot: [
        {
          shipmentId: "cart-1.express",
          timeslot: {
            interval: {
              from: "2026-10-13T09:00:00+03:00",
              to: "2026-10-13T10:00:00+03:00",
            },
            price: 9900,
            type: "timeRange",
          },
        },
      ],
      paymentMethod: { identifier: "NewGrocerySBP" },
      replacementStrategy: { identifier: "REPLACE_GOODS" },
      detailAddress: {
        comment: "Домофон не работает",
        isContactless: false,
        isRover: false,
      },
    });
  });

  test("refuses to place an order that differs from the confirmed one", async () => {
    const { magnit, ctx, requests } = setup({
      ECOM_MAGNIT_STORE: "777885",
      ECOM_MAGNIT_ACCESSTOKEN: "t",
    });
    const preview = await required(magnit, "checkoutPreview")(ctx);

    await expect(
      required(magnit, "placeOrder")({ ...preview, payment: "•••• 0000" }, ctx),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  test("lists recent orders, active ones first, without duplicates", async () => {
    const { magnit, ctx, requests } = setup({ ECOM_MAGNIT_ACCESSTOKEN: "t" });

    const page = await required(magnit, "orders")(ctx);

    expect(
      page.items.map((order) => [order.id, order.status, order.total]),
    ).toEqual([
      ["fy-CM000000002", "in_progress", money(12499)],
      ["fy-CM000000001", "delivered", money(49388)],
    ]);
    const history = requests.find(
      (request) => request.url.pathname === "/v2/orders/history/list",
    );
    expect(history?.url.search).toBe("?limit=10&page=1");
    expect(history?.headers.get("authorization")).toBe("bearer t");
  });

  test("reads an order with weighted goods by weight", async () => {
    const { magnit, ctx } = setup({ ECOM_MAGNIT_ACCESSTOKEN: "t" });

    const order = await required(magnit, "order")("fy-CM000000001", ctx);

    expect(order).toMatchObject({
      createdAt: "2026-10-01T10:15:00+03:00",
      address: { line: "Москва, Тверская улица, 1" },
    });
    expect(
      order.items.map((item) => [
        item.product.title,
        item.quantity,
        item.product.price,
        item.total,
      ]),
    ).toEqual([
      [
        "Молоко Северная долина ультрапастеризованное 3.2% 950г",
        2,
        money(12499),
        money(24998),
      ],
      [
        "Десерт глазированный Акконд Ломтишка, 300 г",
        1,
        money(24390),
        money(24390),
      ],
    ]);
  });

  test.each([[[]], [["55.75"]], [["north", "37.62"]], [["95", "37.62"]]])(
    "rejects stores arguments %p",
    async (args) => {
      const { magnit, ctx } = setup({});

      await expect(
        magnit.commands?.["stores"]?.run(args, ctx) ?? Promise.resolve(),
      ).rejects.toMatchObject({ code: "invalid_input" });
    },
  );
});
