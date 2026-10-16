import { EcomError, type Address, type CheckoutPreview } from "@ecomkit/core";
import {
  addressLine,
  toCart,
  type CartEntity,
  type GeoAddress,
} from "./cart.ts";

const SBP = "СБП";

interface PaymentOption {
  readonly id: string;
  readonly types?: readonly { readonly type?: string | null }[] | null;
}

export interface CheckoutCart extends CartEntity {
  readonly delivery_time?: string | null;
  readonly minimum_amount?: number | null;
  readonly available_payment_types?: readonly PaymentOption[] | null;
  readonly fees?:
    | readonly {
        readonly title?: string | null;
        readonly amount: number;
        readonly required?: boolean | null;
        readonly status?: string | null;
      }[]
    | null;
}

export interface Profile {
  readonly email?: string | null;
}

export function toCheckoutPreview(
  cart: CheckoutCart,
  profile: Profile,
): CheckoutPreview {
  const lines = cart.products ?? [];
  if (lines.length === 0) {
    throw new EcomError("invalid_input", "The cart is empty");
  }
  const stopped = lines.find((line) => line.stop_list_message);
  if (stopped) {
    throw new EcomError(
      "invalid_input",
      `${stopped.name}: ${stopped.stop_list_message}; remove it with \`ecom lifemart remove ${stopped.id}\``,
    );
  }
  if (cart.delivery_type !== "delivery" || !cart.delivery_address) {
    throw new EcomError(
      "invalid_input",
      "Choose a delivery address with `ecom lifemart address <id>`",
    );
  }
  if (!cart.delivery_time) {
    throw new EcomError(
      "invalid_input",
      "Lifemart offers no delivery time for this address now; try again later",
    );
  }
  const goods = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );
  if (cart.minimum_amount && goods < cart.minimum_amount) {
    throw new EcomError(
      "invalid_input",
      `The minimum order is ${cart.minimum_amount} ₽ of goods`,
    );
  }
  const fee = (cart.fees ?? []).find(
    (candidate) =>
      candidate.amount > 0 &&
      (candidate.required || candidate.status === "accepted"),
  );
  if (fee) {
    throw new EcomError(
      "invalid_input",
      `The cart carries a fee (${fee.title ?? "fee"}, ${fee.amount} ₽) that ecom cannot show in the total; place this order in the Lifemart app`,
    );
  }
  if (!offersSbp(cart)) {
    throw new EcomError(
      "invalid_input",
      "Lifemart does not offer SBP payment for this cart",
    );
  }
  if (!profile.email) {
    throw new EcomError(
      "invalid_input",
      "Lifemart needs an email for online payment; add it to your profile in the Lifemart app",
    );
  }
  const { items, subtotal, delivery, total } = toCart(cart);
  return {
    provider: "lifemart",
    items,
    subtotal,
    ...(delivery ? { delivery } : {}),
    total,
    address: toAddress(cart.delivery_address),
    deliveryWindow: { from: cart.delivery_time, to: cart.delivery_time },
    payment: SBP,
  };
}

function offersSbp(cart: CheckoutCart): boolean {
  return (cart.available_payment_types ?? []).some(
    (option) =>
      option.id === "qr" ||
      (option.id === "online" &&
        (option.types ?? []).some((type) => type.type === "qr")),
  );
}

function toAddress(address: GeoAddress): Address {
  return {
    line: addressLine(address),
    ...(address.city ? { city: address.city } : {}),
    ...(address.flat ? { apartment: address.flat } : {}),
    ...(address.comment ? { comment: address.comment } : {}),
  };
}
