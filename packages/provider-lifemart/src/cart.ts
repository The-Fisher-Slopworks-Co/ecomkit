import { EcomError, money, type Cart, type CartItem } from "@ecomkit/core";
import {
  productUrl,
  rubles,
  weightedTitle,
  type CatalogItem,
} from "./catalog.ts";

export interface GeoAddress {
  readonly id?: number | null;
  readonly city?: string | null;
  readonly city_id?: number | null;
  readonly street?: string | null;
  readonly house?: string | null;
  readonly flat?: string | null;
  readonly entrance?: string | null;
  readonly floor?: string | null;
  readonly domofon?: string | null;
  readonly comment?: string | null;
  readonly lat?: number | null;
  readonly lon?: number | null;
}

export interface AddressesResponse {
  readonly data?: readonly GeoAddress[] | null;
  readonly result?: readonly GeoAddress[] | null;
}

interface CartLine {
  readonly id: number;
  readonly idx: number;
  readonly name: string;
  readonly photo?: string | null;
  readonly price: number;
  readonly calc_price?: number | null;
  readonly quantity: number;
  readonly count_step: number;
  readonly is_countable: boolean;
  readonly gift?: boolean | null;
  readonly sel_modifiers?: readonly unknown[] | null;
  readonly stop_list_message?: string | null;
}

interface PromoEvent {
  readonly promocode?: string | null;
  readonly error_message?: string | null;
}

interface TotalNutrition {
  readonly calories: number;
  readonly proteins: number;
  readonly fats: number;
  readonly carbohydrates: number;
}

export interface CartEntity {
  readonly products?: readonly CartLine[] | null;
  readonly promoevents?: readonly PromoEvent[] | null;
  readonly total_amount: number;
  readonly discount_amount?: number | null;
  readonly total_nutrition?: TotalNutrition | null;
  readonly delivery_price?: number | null;
  readonly delivery_type?: string | null;
  readonly delivery_address?: GeoAddress | null;
  readonly delivery_department_id?: number | null;
  readonly cart_department_id?: number | null;
  readonly city_id?: number | null;
}

export interface ChangeCartResponse {
  readonly success: boolean;
  readonly error_message?: string | null;
  readonly cart?: CartEntity | null;
}

export function savedAddresses(
  response: AddressesResponse,
): readonly GeoAddress[] {
  return response.data ?? response.result ?? [];
}

export function addressLine(address: GeoAddress): string {
  return [address.street, address.house].filter(Boolean).join(", ");
}

function toCartItem(line: CartLine): CartItem {
  const total = rubles(line.calc_price ?? line.price * line.quantity);
  const steps = line.is_countable
    ? line.quantity
    : line.quantity / line.count_step;
  return {
    product: {
      id: String(line.id),
      title: line.is_countable
        ? line.name
        : weightedTitle(line.name, Math.round(line.count_step * 1000)),
      price: rubles(
        line.is_countable ? line.price : line.price * line.count_step,
      ),
      url: productUrl(line.id),
      ...(line.photo ? { imageUrl: line.photo } : {}),
      available: !line.stop_list_message,
    },
    quantity: Math.round(steps * 1000) / 1000,
    total,
  };
}

export function toCart(cart: CartEntity): Cart {
  const subtotal = rubles(cart.total_amount);
  const discount = rubles(cart.discount_amount ?? 0);
  const delivery = rubles(cart.delivery_price ?? 0);
  const nutrition = cart.total_nutrition;
  return {
    items: (cart.products ?? []).map(toCartItem),
    subtotal,
    ...(discount.amount > 0 ? { discount } : {}),
    delivery,
    total: money(subtotal.amount - discount.amount + delivery.amount),
    ...(nutrition?.calories
      ? {
          nutrition: {
            kcal: nutrition.calories,
            proteinG: nutrition.proteins,
            fatG: nutrition.fats,
            carbsG: nutrition.carbohydrates,
          },
        }
      : {}),
  };
}

export function promocodeApplied(cart: CartEntity, code: string): CartEntity {
  const event = (cart.promoevents ?? []).find(
    (candidate) => candidate.promocode?.toLowerCase() === code.toLowerCase(),
  );
  if (event?.error_message) {
    throw new EcomError(
      "invalid_input",
      `Lifemart did not apply ${code}: ${event.error_message}`,
    );
  }
  return cart;
}

export function changed(response: ChangeCartResponse): CartEntity {
  if (!response.success || !response.cart) {
    throw new EcomError(
      "invalid_input",
      `Lifemart refused the change: ${response.error_message || "unknown error"}`,
    );
  }
  return response.cart;
}

export function serviceQuantity(item: CatalogItem, steps: number): number {
  return item.is_countable
    ? steps
    : Math.round(steps * item.count_step * 1000) / 1000;
}

export function lineIndex(cart: CartEntity, productId: number): number {
  const lines = cart.products ?? [];
  const line = lines.find(
    (candidate) =>
      candidate.id === productId &&
      !candidate.gift &&
      (candidate.sel_modifiers ?? []).length === 0,
  );
  return (
    line?.idx ?? Math.max(-1, ...lines.map((candidate) => candidate.idx)) + 1
  );
}
