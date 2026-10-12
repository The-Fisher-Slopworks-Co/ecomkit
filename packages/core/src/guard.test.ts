import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  CheckoutGuard,
  FileGuardStore,
  MemoryGuardStore,
  previewDigest,
  type CheckoutResult,
  type GuardStore,
} from "./guard.ts";
import { EcomError } from "./errors.ts";
import { fromMajor, money } from "./money.ts";
import type { Provider, ProviderContext } from "./provider.ts";
import { envSecretStore, providerSecrets } from "./secrets.ts";
import type { CheckoutPreview, Order } from "./types.ts";

const ctx: ProviderContext = {
  secrets: providerSecrets(envSecretStore({}), "shop"),
  http: () => {
    throw new Error("no network in tests");
  },
};

const limits = { perOrder: fromMajor(1_000), perDay: fromMajor(1_500) };
let now = new Date("2026-10-12T12:00:00Z");

function shop(total: number, place?: (preview: CheckoutPreview) => Order) {
  const placed: CheckoutPreview[] = [];
  const preview: CheckoutPreview = {
    provider: "shop",
    items: [
      {
        product: {
          id: "p1",
          title: "Milk",
          price: fromMajor(total),
          available: true,
        },
        quantity: 1,
        total: fromMajor(total),
      },
    ],
    subtotal: fromMajor(total),
    total: fromMajor(total),
    address: { line: "Main st 1", apartment: "5" },
  };
  const provider: Provider = {
    id: "shop",
    title: "Shop",
    secrets: [],
    checkoutPreview: async () => preview,
    placeOrder: async (confirmed) => {
      placed.push(confirmed);
      return (
        place?.(confirmed) ?? {
          id: `order-${placed.length}`,
          status: "created",
          createdAt: now.toISOString(),
          items: confirmed.items,
          total: confirmed.total,
        }
      );
    },
  };
  return { provider, preview, placed };
}

function guard(store: GuardStore = new MemoryGuardStore()) {
  return new CheckoutGuard({ limits, store, now: () => now });
}

function code(result: CheckoutResult): string {
  if (result.status !== "needs_confirmation") throw new Error("placed");
  return result.confirmationCode;
}

beforeEach(() => {
  now = new Date("2026-10-12T12:00:00Z");
});

describe("CheckoutGuard", () => {
  test("never places an order without a confirmation code", async () => {
    const { provider, placed } = shop(500);

    const result = await guard().checkout(provider, ctx);

    expect(result).toMatchObject({
      status: "needs_confirmation",
      confirmationCode: expect.stringMatching(/^[0-9a-f]{8}$/),
      expiresAt: "2026-10-12T12:10:00.000Z",
      spentToday: money(0),
    });
    expect(placed).toHaveLength(0);
  });

  test("places the order once and records the spend", async () => {
    const { provider, preview, placed } = shop(500);
    const store = new MemoryGuardStore();
    const checkoutGuard = guard(store);
    const issued = code(await checkoutGuard.checkout(provider, ctx));

    const result = await checkoutGuard.checkout(provider, ctx, issued);

    expect(result).toEqual({
      status: "placed",
      order: expect.objectContaining({ id: "order-1" }),
      warnings: [],
    });
    expect(placed).toEqual([preview]);
    expect(store.state.spend).toEqual([
      {
        id: expect.any(String),
        provider: "shop",
        at: now.toISOString(),
        status: "placed",
        total: fromMajor(500),
        orderId: "order-1",
      },
    ]);
    await expect(
      checkoutGuard.checkout(provider, ctx, issued),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(placed).toHaveLength(1);
  });

  test("lets only one of several concurrent confirmations through", async () => {
    const { provider, placed } = shop(500);
    const checkoutGuard = guard();
    const issued = code(await checkoutGuard.checkout(provider, ctx));

    const results = await Promise.allSettled(
      [1, 2, 3].map(() => checkoutGuard.checkout(provider, ctx, issued)),
    );

    expect(results.map((r) => r.status).toSorted()).toEqual([
      "fulfilled",
      "rejected",
      "rejected",
    ]);
    expect(placed).toHaveLength(1);
  });

  test("rejects a code once the order changes, including the address", async () => {
    const original = shop(500);
    const checkoutGuard = guard();
    const issued = code(await checkoutGuard.checkout(original.provider, ctx));
    const moved: Provider = {
      ...original.provider,
      checkoutPreview: async () => ({
        ...original.preview,
        address: { line: "Main st 1", apartment: "6" },
      }),
    };

    await expect(
      checkoutGuard.checkout(moved, ctx, issued),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(original.placed).toHaveLength(0);
  });

  test("rejects a code once the payment method changes", async () => {
    const original = shop(500);
    const checkoutGuard = guard();
    const issued = code(await checkoutGuard.checkout(original.provider, ctx));
    const repaid: Provider = {
      ...original.provider,
      checkoutPreview: async () => ({
        ...original.preview,
        payment: "Saved card",
      }),
    };

    await expect(
      checkoutGuard.checkout(repaid, ctx, issued),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(original.placed).toHaveLength(0);
  });

  test("expires codes after ten minutes", async () => {
    const { provider, placed } = shop(500);
    const checkoutGuard = guard();
    const issued = code(await checkoutGuard.checkout(provider, ctx));
    now = new Date("2026-10-12T12:10:01Z");

    await expect(
      checkoutGuard.checkout(provider, ctx, issued),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(placed).toHaveLength(0);
  });

  test("enforces the per-order limit before issuing a code", async () => {
    await expect(
      guard().checkout(shop(1_000.01).provider, ctx),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
  });

  test("counts placed, pending and failed spend of the last 24 hours", async () => {
    const store = new MemoryGuardStore();
    const record = {
      id: "r",
      provider: "shop",
      status: "placed" as const,
      total: fromMajor(500),
    };
    store.state.spend.push(
      { ...record, at: "2026-10-11T11:00:00Z" },
      { ...record, at: "2026-10-11T13:00:00Z" },
      { ...record, status: "failed", at: "2026-10-12T09:00:00Z" },
    );

    await expect(
      guard(store).checkout(shop(501).provider, ctx),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
    expect(await guard(store).checkout(shop(500).provider, ctx)).toMatchObject({
      spentToday: fromMajor(1_000),
    });
  });

  test("only the newest code is valid and placing voids it", async () => {
    const { provider, placed } = shop(500);
    const checkoutGuard = guard();
    const first = code(await checkoutGuard.checkout(provider, ctx));
    const second = code(await checkoutGuard.checkout(provider, ctx));

    await expect(
      checkoutGuard.checkout(provider, ctx, first),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    await checkoutGuard.checkout(provider, ctx, second);
    expect(placed).toHaveLength(1);
  });

  test("forgets the spend when the provider definitely rejects the order", async () => {
    for (const rejection of [
      new EcomError("invalid_input", "below the minimum order"),
      new EcomError("http", "422", { status: 422, body: {} }),
    ]) {
      const store = new MemoryGuardStore();
      const { provider } = shop(500, () => {
        throw rejection;
      });
      const checkoutGuard = guard(store);
      const issued = code(await checkoutGuard.checkout(provider, ctx));

      await expect(checkoutGuard.checkout(provider, ctx, issued)).rejects.toBe(
        rejection,
      );
      expect(store.state.spend).toEqual([]);
    }
  });

  test("keeps an ambiguous failure counted and rethrows", async () => {
    const store = new MemoryGuardStore();
    const { provider } = shop(500, () => {
      throw new Error("provider down");
    });
    const checkoutGuard = guard(store);
    const issued = code(await checkoutGuard.checkout(provider, ctx));

    await expect(checkoutGuard.checkout(provider, ctx, issued)).rejects.toThrow(
      "provider down",
    );
    expect(store.state.spend.map((r) => r.status)).toEqual(["failed"]);
  });

  test("warns when the provider charges a different total", async () => {
    const store = new MemoryGuardStore();
    const { provider } = shop(500, (preview) => ({
      id: "order-1",
      status: "created",
      createdAt: now.toISOString(),
      items: preview.items,
      total: fromMajor(550),
    }));
    const checkoutGuard = guard(store);
    const issued = code(await checkoutGuard.checkout(provider, ctx));

    const result = await checkoutGuard.checkout(provider, ctx, issued);

    expect(result).toMatchObject({
      status: "placed",
      warnings: [expect.stringContaining("differs from the confirmed")],
    });
    expect(store.state.spend[0]?.total).toEqual(fromMajor(550));
  });

  test("refuses an empty cart and providers without checkout", async () => {
    const empty = shop(0);
    const provider: Provider = {
      ...empty.provider,
      checkoutPreview: async () => ({ ...empty.preview, items: [] }),
    };

    await expect(guard().checkout(provider, ctx)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      guard().checkout({ id: "x", title: "X", secrets: [] }, ctx),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  test("digests ignore key order and undefined fields", () => {
    const { preview } = shop(500);
    const reordered = Object.fromEntries([
      ["delivery", undefined],
      ...Object.entries(preview).toReversed(),
    ]) as CheckoutPreview;

    expect(previewDigest(reordered)).toBe(previewDigest(preview));
  });
});

describe("FileGuardStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ecomkit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("persists confirmations across instances", async () => {
    const path = join(dir, "state", "guard.json");
    const { provider, placed } = shop(500);
    const issued = code(
      await guard(new FileGuardStore(path)).checkout(provider, ctx),
    );

    await guard(new FileGuardStore(path)).checkout(provider, ctx, issued);

    expect(placed).toHaveLength(1);
    await expect(
      guard(new FileGuardStore(path)).checkout(provider, ctx, issued),
    ).rejects.toMatchObject({ code: "confirmation_required" });
  });

  test("serializes transactions through the lock file", async () => {
    const path = join(dir, "guard.json");
    const { provider, placed } = shop(500);
    const issued = code(
      await guard(new FileGuardStore(path)).checkout(provider, ctx),
    );

    const results = await Promise.allSettled(
      [1, 2, 3].map(() =>
        guard(new FileGuardStore(path)).checkout(provider, ctx, issued),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(placed).toHaveLength(1);
  });

  test("breaks a lock left by a dead process on this host at once", async () => {
    const path = join(dir, "guard.json");
    await writeFile(`${path}.lock`, `${hostname()}:2147483646:x`);

    expect(
      await guard(new FileGuardStore(path)).checkout(shop(500).provider, ctx),
    ).toMatchObject({ status: "needs_confirmation" });
    expect(await readdir(dir)).toEqual(["guard.json"]);
  });

  test("waits for a live holder and then reports busy", async () => {
    const path = join(dir, "guard.json");
    await writeFile(`${path}.lock`, `${hostname()}:${process.pid}:other`);

    await expect(
      guard(new FileGuardStore(path, { lockTimeoutMs: 100 })).checkout(
        shop(500).provider,
        ctx,
      ),
    ).rejects.toMatchObject({ code: "busy" });
  });

  test.each([['{"spend":'], ["null"], ['{"spend":{}}']])(
    "refuses a corrupt state file %s",
    async (content) => {
      const path = join(dir, "guard.json");
      await writeFile(path, content);

      await expect(
        guard(new FileGuardStore(path)).checkout(shop(500).provider, ctx),
      ).rejects.toThrow(`${path} is corrupt`);
    },
  );

  test("breaks a stale lock from another host", async () => {
    const path = join(dir, "guard.json");
    await writeFile(`${path}.lock`, "other-host:1:x");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(`${path}.lock`, old, old);

    expect(
      await guard(new FileGuardStore(path)).checkout(shop(500).provider, ctx),
    ).toMatchObject({ status: "needs_confirmation" });
  });
});
