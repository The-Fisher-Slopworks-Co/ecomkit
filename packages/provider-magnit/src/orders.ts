import {
  money,
  type CartItem,
  type Order,
  type OrderStatus,
} from "@ecomkit/core";
import { productUrl, weightedTitle } from "./cart.ts";

interface OrderItem {
  readonly article: string;
  readonly name: string;
  readonly qnty: number;
  readonly unit: string;
  readonly priceDiscount: number;
  readonly priceDiscountPosition: number;
  readonly pictureUrl?: string;
}

export interface OrderInfoResponse {
  readonly orderId: string;
  readonly createdAt: string;
  readonly status: { readonly code: string };
  readonly shop: { readonly id: string };
  readonly items: readonly OrderItem[];
  readonly totalPrice: number;
  readonly formattedAddress?: string;
  readonly payment?: { readonly link?: string };
}

export interface OrdersListResponse {
  readonly items: readonly { readonly orderId: string }[];
}

const STATUSES: Readonly<Record<string, OrderStatus>> = {
  NEW: "created",
  WAITING: "created",
  WAITING_PAY: "created",
  ON_ASSEMBLE: "in_progress",
  ASSEMBLED: "in_progress",
  REPLACEMENTS: "in_progress",
  UPLOADED_TO_CASH: "in_progress",
  ON_WAY: "delivering",
  ON_DELIVERY_TO_PICKUP: "delivering",
  COMPLETED: "delivered",
  ISSUED_TO_BUYER: "delivered",
  CANCELED: "cancelled",
  CANCELED_NO_PAY: "cancelled",
  PAY_ERROR: "cancelled",
  NO_REPURCHASE: "cancelled",
};

export function toOrder(info: OrderInfoResponse): Order {
  return {
    id: info.orderId,
    status: STATUSES[info.status.code] ?? "in_progress",
    createdAt: info.createdAt,
    items: info.items.map((item) => toOrderItem(item, info.shop.id)),
    total: money(info.totalPrice),
    ...(info.formattedAddress
      ? { address: { line: info.formattedAddress } }
      : {}),
    ...(info.payment?.link ? { paymentUrl: info.payment.link } : {}),
  };
}

function toOrderItem(item: OrderItem, store: string): CartItem {
  const weighted = item.unit === "WEIGHT";
  const total = money(item.priceDiscountPosition);
  return {
    product: {
      id: item.article,
      title: weighted ? weightedTitle(item.name, item.qnty) : item.name,
      price: weighted ? total : money(item.priceDiscount),
      url: productUrl(item.article, store),
      ...(item.pictureUrl ? { imageUrl: item.pictureUrl } : {}),
      available: true,
    },
    quantity: weighted ? 1 : item.qnty,
    total,
  };
}
