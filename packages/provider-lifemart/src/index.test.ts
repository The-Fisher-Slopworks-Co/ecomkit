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
}

function fixtureFile(method: string, url: URL): string | null {
  if (method === "GET" && url.pathname === "/api/menu/search") {
    return "menu-search.json";
  }
  if (
    method === "GET" &&
    url.pathname === "/api/services/catalog-api-service/product"
  ) {
    return url.searchParams.get("id") === "25423" ? "product-25423.json" : null;
  }
  throw new Error(`No fixture for ${method} ${url.href}`);
}

function setup() {
  const requests: Recorded[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    requests.push({ method, url, headers: new Headers(init?.headers) });
    const file = fixtureFile(method, url);
    const body =
      file === null ? "null" : await readFile(new URL(file, FIXTURES), "utf8");
    return new Response(body, {
      headers: { "content-type": "application/json" },
    });
  };
  const ctx: ProviderContext = {
    secrets: providerSecrets(envSecretStore({}), "lifemart"),
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
});
