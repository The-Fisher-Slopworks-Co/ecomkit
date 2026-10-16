import { describe, expect, test } from "bun:test";
import { fromMajor, type Cart } from "@ecomkit/core";
import { formatCart } from "./format.ts";

const milk = {
  product: {
    id: "milk-1",
    title: "Молоко",
    price: fromMajor(99),
    available: true,
  },
  quantity: 2,
  total: fromMajor(198),
};

describe("formatCart", () => {
  test("shows only the total without delivery or discount", () => {
    const cart: Cart = {
      items: [milk],
      subtotal: fromMajor(198),
      total: fromMajor(198),
    };

    expect(formatCart(cart)).toBe(
      ["2 × Молоко (milk-1)  198 ₽", "Total: 198 ₽"].join("\n"),
    );
  });

  test("subtracts a discount before delivery", () => {
    const cart: Cart = {
      items: [milk],
      subtotal: fromMajor(198),
      discount: fromMajor(48),
      delivery: fromMajor(99),
      total: fromMajor(249),
    };

    expect(formatCart(cart)).toBe(
      [
        "2 × Молоко (milk-1)  198 ₽",
        "Subtotal: 198 ₽",
        "Discount: −48 ₽",
        "Delivery: 99 ₽",
        "Total: 249 ₽",
      ].join("\n"),
    );
  });
});
