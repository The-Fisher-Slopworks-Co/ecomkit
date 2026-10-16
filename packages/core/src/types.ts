import type { Money } from "./money.ts";

export interface Address {
  readonly line: string;
  readonly city?: string;
  readonly apartment?: string;
  readonly comment?: string;
  readonly lat?: number;
  readonly lon?: number;
}

export interface Product {
  readonly id: string;
  readonly title: string;
  readonly price: Money;
  readonly oldPrice?: Money;
  readonly url?: string;
  readonly imageUrl?: string;
  readonly brand?: string;
  readonly available: boolean;
  readonly description?: string;
}

export interface CartItem {
  readonly product: Product;
  readonly quantity: number;
  readonly total: Money;
}

export interface Cart {
  readonly items: readonly CartItem[];
  readonly subtotal: Money;
  readonly discount?: Money;
  readonly delivery?: Money;
  readonly total: Money;
}

export type OrderStatus =
  "created" | "paid" | "in_progress" | "delivering" | "delivered" | "cancelled";

export interface Order {
  readonly id: string;
  readonly status: OrderStatus;
  readonly createdAt: string;
  readonly items: readonly CartItem[];
  readonly total: Money;
  readonly address?: Address;
  readonly paymentUrl?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface SearchQuery {
  readonly text: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface DeliveryWindow {
  readonly from: string;
  readonly to: string;
}

export interface CheckoutPreview {
  readonly provider: string;
  readonly items: readonly CartItem[];
  readonly subtotal: Money;
  readonly discount?: Money;
  readonly delivery?: Money;
  readonly total: Money;
  readonly address?: Address;
  readonly deliveryWindow?: DeliveryWindow;
  readonly payment?: string;
}
