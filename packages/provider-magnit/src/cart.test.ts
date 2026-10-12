import { describe, expect, test } from "bun:test";
import { money } from "@ecomkit/core";
import preview from "../../../fixtures/magnit/checkout-preview.json" with { type: "json" };
import { toCart } from "./cart.ts";

describe("magnit cart", () => {
  test("turns the checkout preview into a priced cart", () => {
    const cart = toCart(preview);

    expect(
      cart.items.map((item) => [item.product.id, item.quantity, item.total]),
    ).toEqual([
      ["1000049786", 2, money(24998)],
      ["1000127183", 1, money(20249)],
      ["1000078228", 2, money(48780)],
    ]);
    expect(cart.items[0]?.product).toMatchObject({
      price: money(12499),
      imageUrl: "https://images-foodtech.magnit.ru/example/milk.jpeg@webp",
      url: "https://magnit.ru/product/1000049786?shopCode=777885&shopType=express&catalogType=2",
    });
    expect(cart.items[2]?.product).toMatchObject({
      title: "Десерт глазированный Акконд Ломтишка, 300 г",
      price: money(24390),
    });
    expect(cart.subtotal).toEqual(money(94027));
    expect(cart.delivery).toEqual(money(9900));
    expect(cart.total).toEqual(money(103927));
  });

  test("asks for a delivery address when the account has none", () => {
    expect(() => toCart({ ...preview, deliveryInfo: {} })).toThrow(
      "delivery address",
    );
  });
});
