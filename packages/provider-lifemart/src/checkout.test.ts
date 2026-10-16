import { describe, expect, test } from "bun:test";
import { money } from "@ecomkit/core";
import fixture from "../../../fixtures/lifemart/cart-checkout.json" with { type: "json" };
import {
  createdOrderId,
  orderRequest,
  paymentLink,
  toCheckoutPreview,
  type CheckoutCart,
} from "./checkout.ts";

const cart = fixture as CheckoutCart;
const profile = { email: "buyer@example.com" };

describe("toCheckoutPreview", () => {
  test("shows items, delivery, address, time and SBP payment", () => {
    expect(toCheckoutPreview(cart, profile)).toEqual({
      provider: "lifemart",
      items: [
        expect.objectContaining({ quantity: 2, total: money(18800) }),
        expect.objectContaining({ quantity: 2, total: money(6840) }),
      ],
      subtotal: money(25640),
      delivery: money(9900),
      total: money(35540),
      address: {
        line: "улица Ленина, 1",
        city: "Екатеринбург",
        apartment: "1",
        comment: "Домофон не работает",
      },
      deliveryWindow: {
        from: "2026-01-01T12:40:00+05:00",
        to: "2026-01-01T12:40:00+05:00",
      },
      payment: "СБП",
    });
  });

  test.each<[string, Partial<CheckoutCart>, string]>([
    ["an empty cart", { products: [] }, "The cart is empty"],
    ["a cart below the minimum", { minimum_amount: 1299 }, "minimum order"],
    [
      "a cart without SBP",
      { available_payment_types: [{ id: "cash" }] },
      "SBP",
    ],
    ["a cart without a time", { delivery_time: null }, "no delivery time"],
    ["a pickup cart", { delivery_type: "self" }, "ecom lifemart address"],
    [
      "a cart with a fee",
      { fees: [{ title: "Сбор", amount: 29, required: true }] },
      "fee",
    ],
    [
      "a cart with a stopped item",
      {
        products: [
          {
            ...cart.products![0]!,
            stop_list_message: "Нет в магазине",
          },
        ],
      },
      "Нет в магазине",
    ],
  ])("refuses %s", (_name, change, message) => {
    expect(() => toCheckoutPreview({ ...cart, ...change }, profile)).toThrow(
      message,
    );
  });

  test("subtracts a promo code discount from the total", () => {
    const preview = toCheckoutPreview(
      { ...cart, discount_amount: 26 },
      profile,
    );

    expect(preview).toMatchObject({
      subtotal: money(25640),
      discount: money(2600),
      delivery: money(9900),
      total: money(32940),
    });
  });

  test("asks for an email in the profile", () => {
    expect(() => toCheckoutPreview(cart, { email: "" })).toThrow("email");
  });
});

describe("orderRequest", () => {
  test("pays by SBP with the profile email and the address comment", () => {
    expect(orderRequest(cart, profile)).toEqual({
      delivery_address: { comment: "Домофон не работает" },
      payment_info: {
        type: "online",
        change_from: 0,
        is_qr_prepayment: true,
        online: { type: "qr" },
      },
      user_data: { email: "buyer@example.com" },
      is_geolocation_allowed: false,
      is_rover_delivery: false,
    });
  });
});

describe("order creation", () => {
  test("prefers the SBP link for payment", () => {
    expect(
      paymentLink({
        success: true,
        payment_url: "https://p",
        qr_url: "https://q",
      }),
    ).toEqual({ paymentUrl: "https://q" });
    expect(paymentLink({ success: true, payment_url: "https://p" })).toEqual({
      paymentUrl: "https://p",
    });
  });

  test("passes on a refusal", () => {
    expect(() =>
      createdOrderId({
        success: false,
        error_code: "stop_list",
        error_message: "Товар закончился",
      }),
    ).toThrow("Товар закончился");
  });
});
