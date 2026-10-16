import {
  money,
  type Macros,
  type Money,
  type Nutrition,
  type Product,
} from "@ecomkit/core";

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
  readonly info?: NutritionInfo | null;
}

type Amount = string | number | null | undefined;

interface NutritionInfo {
  readonly weight?: string | null;
  readonly calories?: Amount;
  readonly proteins?: Amount;
  readonly fats?: Amount;
  readonly carbohydrates?: Amount;
  readonly calories_100?: Amount;
  readonly proteins_100?: Amount;
  readonly fats_100?: Amount;
  readonly carbohydrates_100?: Amount;
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

function parseAmount(value: Amount): number | undefined {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(parsed)
    ? undefined
    : Math.round(parsed * 10) / 10;
}

function macros(...values: Amount[]): Macros | undefined {
  const [kcal, proteinG, fatG, carbsG] = values.map(parseAmount);
  return kcal === undefined ||
    proteinG === undefined ||
    fatG === undefined ||
    carbsG === undefined
    ? undefined
    : { kcal, proteinG, fatG, carbsG };
}

function toNutrition(info: NutritionInfo): Nutrition | undefined {
  const perPortion = macros(
    info.calories,
    info.proteins,
    info.fats,
    info.carbohydrates,
  );
  const per100g = macros(
    info.calories_100,
    info.proteins_100,
    info.fats_100,
    info.carbohydrates_100,
  );
  if (!perPortion && !per100g) return undefined;
  return {
    ...(perPortion && info.weight ? { portion: info.weight } : {}),
    ...(perPortion ? { perPortion } : {}),
    ...(per100g ? { per100g } : {}),
  };
}

export function toProduct(item: CatalogItem): Product {
  const grams = stepGrams(item);
  const nutrition = item.info ? toNutrition(item.info) : undefined;
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
    ...(nutrition ? { nutrition } : {}),
  };
}
