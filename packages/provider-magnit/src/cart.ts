import {
  EcomError,
  money,
  sumMoney,
  type Cart,
  type CartItem,
} from "@ecomkit/core";

export const EXPRESS = { storeType: "express", catalogType: "2" } as const;

interface PreviewItem {
  readonly goodId: string;
  readonly title: string;
  readonly type: string;
  readonly qnty: number;
  readonly isAvailable: boolean;
  readonly totalFinalPrice: number;
  readonly volume: {
    readonly price: number;
    readonly unit: string;
    readonly value: number;
  };
  readonly image?: { readonly prefixUrl: string; readonly postfixUrl: string };
}

export interface CheckoutPreviewResponse {
  readonly deliveryInfo?: {
    readonly store?: { readonly storeCode: string };
  };
  readonly suborders: readonly { readonly items: readonly PreviewItem[] }[];
  readonly summary: {
    readonly totalFinalPrice: number;
    readonly prices: readonly {
      readonly title: string;
      readonly value: number;
    }[];
  };
}

export function deliveryStore(preview: CheckoutPreviewResponse): string {
  const store = preview.deliveryInfo?.store?.storeCode;
  if (!store) {
    throw new EcomError(
      "invalid_input",
      "Choose a delivery address in the Magnit app first",
    );
  }
  return store;
}

export function weightedTitle(title: string, grams: number): string {
  return `${title}, ${grams} г`;
}

export function productUrl(id: string, store: string): string {
  const url = new URL(`https://magnit.ru/product/${id}`);
  url.search = new URLSearchParams({
    shopCode: store,
    shopType: EXPRESS.storeType,
    catalogType: EXPRESS.catalogType,
  }).toString();
  return url.toString();
}

export function toCart(preview: CheckoutPreviewResponse): Cart {
  const store = deliveryStore(preview);
  const items: CartItem[] = preview.suborders
    .flatMap((suborder) => suborder.items)
    .filter((item) => item.type === "product" && item.isAvailable)
    .map((item) => {
      const weighted = item.volume.unit === "weight";
      const imageUrl = item.image
        ? `${item.image.prefixUrl}${item.image.postfixUrl}`
        : "";
      return {
        product: {
          id: item.goodId,
          title: weighted
            ? weightedTitle(item.title, item.volume.value)
            : item.title,
          price: money(item.volume.price),
          url: productUrl(item.goodId, store),
          ...(imageUrl ? { imageUrl } : {}),
          available: true,
        },
        quantity: weighted ? item.qnty / item.volume.value : item.qnty,
        total: money(item.totalFinalPrice),
      };
    });
  const subtotal = money(preview.summary.totalFinalPrice);
  const delivery = sumMoney(
    preview.summary.prices.map((price) => money(price.value)),
  );
  return {
    items,
    subtotal,
    delivery,
    total: sumMoney([subtotal, delivery]),
  };
}
