import {
  EcomError,
  multiplyMoney,
  sumMoney,
  type Cart,
  type CartItem,
  type CheckoutPreview,
  type Order,
  type Product,
  type Provider,
} from "@ecomkit/core";
import fixture from "../../../fixtures/mock/catalog.json" with { type: "json" };

const DEFAULT_PAGE_SIZE = 20;

export function createMockProvider(
  catalog: readonly Product[] = fixture,
): Provider {
  const quantities = new Map<string, number>();
  const orders: Order[] = [];

  function find(id: string): Product {
    const product = catalog.find((candidate) => candidate.id === id);
    if (!product) throw new EcomError("not_found", `No product ${id}`);
    return product;
  }

  function cart(): Cart {
    const items: CartItem[] = [...quantities].map(([id, quantity]) => {
      const product = find(id);
      return {
        product,
        quantity,
        total: multiplyMoney(product.price, quantity),
      };
    });
    const subtotal = sumMoney(items.map((item) => item.total));
    return { items, subtotal, total: subtotal };
  }

  return {
    id: "mock",
    title: "Mock shop (fixtures, in-memory cart)",
    secrets: [],

    async search({ text, limit = DEFAULT_PAGE_SIZE, cursor }) {
      const needle = text.trim().toLowerCase();
      const matches = catalog.filter((product) =>
        [product.title, product.brand ?? ""].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      );
      const offset = cursor === undefined ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new EcomError("invalid_input", `Bad cursor ${cursor}`);
      }
      const end = offset + limit;
      return {
        items: matches.slice(offset, end),
        ...(end < matches.length ? { nextCursor: String(end) } : {}),
      };
    },

    product: async (id) => find(id),

    cart: async () => cart(),

    async setCartItem(productId, quantity) {
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new EcomError(
          "invalid_input",
          `Quantity must be a non-negative integer, got ${quantity}`,
        );
      }
      const product = find(productId);
      if (quantity === 0) {
        quantities.delete(productId);
      } else if (!product.available) {
        throw new EcomError(
          "invalid_input",
          `${product.title} is out of stock`,
        );
      } else {
        quantities.set(productId, quantity);
      }
      return cart();
    },

    async checkoutPreview(): Promise<CheckoutPreview> {
      const { items, subtotal, total } = cart();
      return {
        provider: "mock",
        items,
        subtotal,
        total,
        address: { line: "Test street 1" },
      };
    },

    async placeOrder(preview) {
      const order: Order = {
        id: `mock-${orders.length + 1}`,
        status: "created",
        createdAt: new Date().toISOString(),
        items: preview.items,
        total: preview.total,
        ...(preview.address ? { address: preview.address } : {}),
      };
      orders.push(order);
      quantities.clear();
      return order;
    },

    orders: async () => ({ items: orders.toReversed() }),

    async order(id) {
      const order = orders.find((candidate) => candidate.id === id);
      if (!order) throw new EcomError("not_found", `No order ${id}`);
      return order;
    },

    commands: {
      reset: {
        description: "Empty the cart and forget placed orders",
        async run() {
          quantities.clear();
          orders.length = 0;
          return { reset: true };
        },
      },
    },
  };
}
