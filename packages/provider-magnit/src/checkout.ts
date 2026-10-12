import { EcomError, type Address, type CheckoutPreview } from "@ecomkit/core";
import { toCart, type CheckoutPreviewResponse } from "./cart.ts";

interface Timeslot {
  readonly interval?: { readonly from: string; readonly to: string };
}

interface Shipment {
  readonly id: string;
  readonly timeslot: { readonly selected?: Timeslot };
}

interface Selection<T> {
  readonly available: readonly T[];
  readonly selectedId?: string;
}

export interface CheckoutResponse {
  readonly id: string;
  readonly customer?: {
    readonly name?: string;
    readonly phone?: string;
    readonly email?: string;
  };
  readonly deliveryInfo?: {
    readonly isContactless?: boolean;
    readonly address?: {
      readonly fullAddress?: string;
      readonly city?: string;
      readonly apartment?: string;
      readonly comment?: string;
      readonly latitude?: number;
      readonly longitude?: number;
    };
  };
  readonly shipments: { readonly items: readonly Shipment[] };
  readonly paymentMethods: Selection<{
    readonly id: string;
    readonly title: string;
  }>;
  readonly replacementStrategies: Selection<{ readonly id: string }>;
}

export function checkoutCartId(preview: CheckoutPreviewResponse): string {
  const restriction = preview.restrictions?.[0];
  if (restriction) {
    throw new EcomError(
      "invalid_input",
      `${restriction.title}: ${restriction.description}`,
    );
  }
  const [suborder, ...rest] = preview.suborders;
  if (suborder === undefined) {
    throw new EcomError("invalid_input", "The cart is empty");
  }
  if (rest.length > 0) {
    throw new EcomError(
      "invalid_input",
      "The cart splits into several orders; place it in the Magnit app",
    );
  }
  return suborder.id;
}

export function toCheckoutPreview(
  preview: CheckoutPreviewResponse,
  checkout: CheckoutResponse,
): CheckoutPreview {
  const cart = toCart(preview);
  if (cart.items.length === 0) {
    throw new EcomError("invalid_input", "The cart is empty");
  }
  const payment = checkout.paymentMethods.available.find(
    (method) => method.id === checkout.paymentMethods.selectedId,
  );
  if (payment === undefined) {
    throw new EcomError(
      "invalid_input",
      "Choose a payment method in the Magnit app first",
    );
  }
  const address = toAddress(checkout);
  const deliveryWindow = selectedTimeslot(checkout).interval;
  return {
    provider: "magnit",
    ...cart,
    ...(address ? { address } : {}),
    ...(deliveryWindow
      ? { deliveryWindow: { from: deliveryWindow.from, to: deliveryWindow.to } }
      : {}),
    payment: payment.title,
  };
}

export function orderRequest(checkout: CheckoutResponse) {
  const email = checkout.customer?.email;
  if (!email) {
    throw new EcomError(
      "invalid_input",
      "Add an email to the Magnit profile first",
    );
  }
  const strategy = checkout.replacementStrategies.selectedId;
  const address = checkout.deliveryInfo?.address;
  return {
    customer: { ...checkout.customer, email },
    deliveryTimeSlot: [
      {
        shipmentId: checkout.shipments.items[0]?.id,
        timeslot: selectedTimeslot(checkout),
      },
    ],
    paymentMethod: { identifier: checkout.paymentMethods.selectedId },
    ...(strategy ? { replacementStrategy: { identifier: strategy } } : {}),
    detailAddress: {
      ...(address?.comment ? { comment: address.comment } : {}),
      isContactless: checkout.deliveryInfo?.isContactless ?? false,
      isRover: false,
    },
  };
}

function selectedTimeslot(checkout: CheckoutResponse): Timeslot {
  const [shipment, ...rest] = checkout.shipments.items;
  const timeslot = shipment?.timeslot.selected;
  if (timeslot === undefined || rest.length > 0) {
    throw new EcomError(
      "invalid_input",
      "Choose one delivery time in the Magnit app first",
    );
  }
  return timeslot;
}

function toAddress(checkout: CheckoutResponse): Address | undefined {
  const address = checkout.deliveryInfo?.address;
  if (!address?.fullAddress) return undefined;
  return {
    line: address.fullAddress,
    ...(address.apartment ? { apartment: address.apartment } : {}),
    ...(address.comment ? { comment: address.comment } : {}),
    ...(address.latitude === undefined ? {} : { lat: address.latitude }),
    ...(address.longitude === undefined ? {} : { lon: address.longitude }),
  };
}
