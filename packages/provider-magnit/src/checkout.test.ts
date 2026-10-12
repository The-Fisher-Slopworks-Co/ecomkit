import { describe, expect, test } from "bun:test";
import checkout from "../../../fixtures/magnit/checkout-cart.json" with { type: "json" };
import preview from "../../../fixtures/magnit/checkout-preview.json" with { type: "json" };
import { checkoutCartId, orderRequest, toCheckoutPreview } from "./checkout.ts";

describe("magnit checkout", () => {
  test("stops at the store's minimum order", () => {
    expect(() =>
      checkoutCartId({
        ...preview,
        restrictions: [
          { title: "Заказ от 300 ₽", description: "Не хватает ещё 252 ₽" },
        ],
      }),
    ).toThrow("Заказ от 300 ₽: Не хватает ещё 252 ₽");
  });

  test("refuses a cart that splits into several orders", () => {
    const [suborder] = preview.suborders;
    if (suborder === undefined) throw new Error("fixture lacks a suborder");

    expect(() =>
      checkoutCartId({
        ...preview,
        suborders: [suborder, { ...suborder, id: "cart-2.express" }],
      }),
    ).toThrow("several orders");
  });

  test("asks for a payment method the account has not chosen", () => {
    const unpaid = {
      ...checkout,
      paymentMethods: { ...checkout.paymentMethods, selectedId: "gone" },
    };

    expect(() => toCheckoutPreview(preview, unpaid)).toThrow("payment method");
  });

  test("needs an email in the profile to place an order", () => {
    expect(() =>
      orderRequest({ ...checkout, customer: { phone: "79990000000" } }),
    ).toThrow("email");
  });
});
