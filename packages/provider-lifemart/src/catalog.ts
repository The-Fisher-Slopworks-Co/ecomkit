import { money, type Money, type Product } from "@ecomkit/core";

export interface CatalogItem {
  readonly id: number;
  readonly name: string;
  readonly price: number;
  readonly price_before_discount?: number | null;
  readonly count_step: number;
  readonly is_countable: boolean;
  readonly max_quantity?: number | null;
  readonly photo?: string | null;
  readonly description?: string | null;
  readonly consist?: string | null;
}

export function rubles(amount: number): Money {
  return money(Math.round(amount * 100));
}

function stepGrams(item: CatalogItem): number | undefined {
  return item.is_countable ? undefined : Math.round(item.count_step * 1000);
}

export function weightedTitle(title: string, grams: number): string {
  return `${title}, ${grams} г`;
}

export function productUrl(id: number | string): string {
  return `https://lifemart.ru/product/${id}`;
}

function stepPrice(item: CatalogItem, price: number): Money {
  return rubles(item.is_countable ? price : price * item.count_step);
}

export function toProduct(item: CatalogItem): Product {
  const grams = stepGrams(item);
  const oldPrice = item.price_before_discount;
  const description = item.description || item.consist;
  return {
    id: String(item.id),
    title: grams === undefined ? item.name : weightedTitle(item.name, grams),
    price: stepPrice(item, item.price),
    ...(oldPrice && oldPrice > item.price
      ? { oldPrice: stepPrice(item, oldPrice) }
      : {}),
    url: productUrl(item.id),
    ...(item.photo ? { imageUrl: item.photo } : {}),
    available: (item.max_quantity ?? 0) > 0,
    ...(description ? { description } : {}),
  };
}
