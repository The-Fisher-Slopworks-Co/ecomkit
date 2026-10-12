import { describe, expect, test } from "bun:test";
import {
  CheckoutGuard,
  MemoryGuardStore,
  envSecretStore,
  fromMajor,
  money,
  providerSecrets,
  type Provider,
  type ProviderContext,
} from "@ecomkit/core";
import { createMockProvider } from "./index.ts";

const ctx: ProviderContext = {
  secrets: providerSecrets(envSecretStore({}), "mock"),
  http: () => {
    throw new Error("the mock provider never touches the network");
  },
};

function required<K extends keyof Provider>(provider: Provider, key: K) {
  const method = provider[key];
  if (method === undefined) throw new Error(`mock lacks ${key}`);
  return method;
}

describe("mock provider", () => {
  test("searches titles and brands case-insensitively with paging", async () => {
    const mock = createMockProvider();
    const search = required(mock, "search");

    const first = await search({ text: "МОЛОКО", limit: 1 }, ctx);
    expect(first.items.map((p) => p.id)).toEqual(["milk-1"]);
    expect(first.nextCursor).toBe("1");

    const second = await search({ text: "молоко", limit: 1, cursor: "1" }, ctx);
    expect(second.items.map((p) => p.id)).toEqual(["milk-2"]);
    expect(second.nextCursor).toBeUndefined();

    expect((await search({ text: "lavazza" }, ctx)).items).toHaveLength(1);
  });

  test("keeps a cart with totals and removes items at zero", async () => {
    const mock = createMockProvider();
    const setCartItem = required(mock, "setCartItem");

    await setCartItem("milk-1", 2, ctx);
    const cart = await setCartItem("bread-1", 1, ctx);
    expect(cart.total).toEqual(money(2 * 12990 + 8990));

    const after = await setCartItem("milk-1", 0, ctx);
    expect(after.items.map((item) => item.product.id)).toEqual(["bread-1"]);
  });

  test("rejects unknown, unavailable and fractional items", async () => {
    const setCartItem = required(createMockProvider(), "setCartItem");

    await expect(setCartItem("nope", 1, ctx)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(setCartItem("cheese-1", 1, ctx)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(setCartItem("milk-1", 1.5, ctx)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  test("checks out through the guard and lists the order", async () => {
    const mock = createMockProvider();
    await required(mock, "setCartItem")("milk-1", 1, ctx);
    const guard = new CheckoutGuard({
      limits: { perOrder: fromMajor(1_000), perDay: fromMajor(1_000) },
      store: new MemoryGuardStore(),
    });

    const pending = await guard.checkout(mock, ctx);
    if (pending.status !== "needs_confirmation") throw new Error("placed");
    const placed = await guard.checkout(mock, ctx, pending.confirmationCode);

    expect(placed).toMatchObject({
      status: "placed",
      order: { id: "mock-1", total: money(12990) },
    });
    expect((await required(mock, "cart")(ctx)).items).toEqual([]);
    expect((await required(mock, "orders")(ctx)).items).toHaveLength(1);
    expect(await required(mock, "order")("mock-1", ctx)).toMatchObject({
      status: "created",
    });

    await mock.commands?.["reset"]?.run([], ctx);
    expect((await required(mock, "orders")(ctx)).items).toEqual([]);
  });
});
