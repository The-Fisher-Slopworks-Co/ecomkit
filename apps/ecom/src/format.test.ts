import { describe, expect, test } from "bun:test";
import { fromMajor, type Cart } from "@ecomkit/core";
import { formatCart, formatProduct, formatProducts } from "./format.ts";

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

  test("totals the nutrition of the cart", () => {
    const cart: Cart = {
      items: [milk],
      subtotal: fromMajor(198),
      total: fromMajor(198),
      nutrition: { kcal: 180, proteinG: 14, fatG: 13, carbsG: 2 },
    };

    expect(formatCart(cart)).toEndWith(
      "Total: 198 ₽\nNutrition: 180 kcal, protein 14 g, fat 13 g, carbs 2 g",
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

const salad = {
  id: "salad-1",
  title: "Салат с курицей",
  price: fromMajor(235),
  available: true,
  nutrition: {
    portion: "200 g",
    perPortion: { kcal: 164, proteinG: 17.4, fatG: 7.4, carbsG: 7.2 },
    per100g: { kcal: 82, proteinG: 8.7, fatG: 3.7, carbsG: 3.6 },
  },
};

describe("nutrition", () => {
  test("follows each search result with its portion", () => {
    expect(formatProducts({ items: [salad] })).toBe(
      "salad-1  Салат с курицей  235 ₽  200 g: 164 kcal, protein 17.4 g, fat 7.4 g, carbs 7.2 g",
    );
  });

  test("shows the portion and 100 g on the product card", () => {
    expect(formatProduct(salad)).toContain(
      "nutrition: 200 g: 164 kcal, protein 17.4 g, fat 7.4 g, carbs 7.2 g; 100 g: 82 kcal, protein 8.7 g, fat 3.7 g, carbs 3.6 g",
    );
  });

  test("falls back to 100 g without a portion", () => {
    const { perPortion: _portion, ...per100g } = salad.nutrition;

    expect(
      formatProducts({ items: [{ ...salad, nutrition: per100g }] }),
    ).toContain("100 g: 82 kcal, protein 8.7 g");
  });
});
