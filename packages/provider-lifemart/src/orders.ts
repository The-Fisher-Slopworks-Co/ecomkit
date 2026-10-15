import type { Address, CartItem, Order, OrderStatus } from "@ecomkit/core";
import { productUrl, rubles, weightedTitle } from "./catalog.ts";

interface OrderProduct {
  readonly id: number;
  readonly name: string;
  readonly photo?: string | null;
  readonly price: number;
  readonly quantity: number;
  readonly is_countable: boolean;
}

export interface OrderEntity {
  readonly id: number;
  readonly create_time: string;
  readonly status?: { readonly id: number } | null;
  readonly complete?: boolean | null;
  readonly cancelled?: boolean | null;
  readonly delivery_type?: string | null;
  readonly delivery_address?: string | null;
  readonly delivery_address_add_info?: string | null;
  readonly delivery_department_address?: string | null;
  readonly city_name?: string | null;
  readonly total_amount: number;
  readonly products?: readonly OrderProduct[] | null;
}

export interface OrdersResponse {
  readonly orders: readonly OrderEntity[];
}

const STATUSES: Readonly<Record<number, OrderStatus>> = {
  10: "created",
  60: "created",
  20: "in_progress",
  100: "in_progress",
  80: "delivering",
  30: "delivered",
};

export function toOrder(order: OrderEntity): Order {
  const address = orderAddress(order);
  return {
    id: String(order.id),
    status: orderStatus(order),
    createdAt: new Date(order.create_time).toISOString(),
    items: (order.products ?? []).map(toOrderItem),
    total: rubles(order.total_amount),
    ...(address ? { address } : {}),
  };
}

function orderStatus(order: OrderEntity): OrderStatus {
  if (order.cancelled) return "cancelled";
  if (order.complete) return "delivered";
  return STATUSES[order.status?.id ?? -1] ?? "in_progress";
}

function orderAddress(order: OrderEntity): Address | undefined {
  const city = order.city_name ? { city: order.city_name } : {};
  if (order.delivery_type === "self") {
    return order.delivery_department_address
      ? { line: order.delivery_department_address, ...city, comment: "pickup" }
      : undefined;
  }
  if (!order.delivery_address) return undefined;
  return {
    line: order.delivery_address,
    ...city,
    ...(order.delivery_address_add_info
      ? { apartment: order.delivery_address_add_info }
      : {}),
  };
}

function toOrderItem(product: OrderProduct): CartItem {
  const total = rubles(product.price * product.quantity);
  return {
    product: {
      id: String(product.id),
      title: product.is_countable
        ? product.name
        : weightedTitle(product.name, Math.round(product.quantity * 1000)),
      price: product.is_countable ? rubles(product.price) : total,
      url: productUrl(product.id),
      ...(product.photo ? { imageUrl: product.photo } : {}),
      available: true,
    },
    quantity: product.is_countable ? product.quantity : 1,
    total,
  };
}
