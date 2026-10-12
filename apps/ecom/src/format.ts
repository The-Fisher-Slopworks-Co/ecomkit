import {
  formatMoney,
  type Address,
  type Cart,
  type CheckoutResult,
  type Order,
  type Page,
  type Product,
} from "@ecomkit/core";

export function formatProducts(page: Page<Product>): string {
  const lines = page.items.map(
    (product) =>
      `${product.id}  ${product.title}  ${formatMoney(product.price)}${product.available ? "" : "  (out of stock)"}`,
  );
  if (lines.length === 0) lines.push("Nothing found");
  if (page.nextCursor !== undefined) {
    lines.push(`More: --cursor ${page.nextCursor}`);
  }
  return lines.join("\n");
}

export function formatProduct(product: Product): string {
  return [
    product.title,
    `id: ${product.id}`,
    `price: ${formatMoney(product.price)}${product.oldPrice ? ` (was ${formatMoney(product.oldPrice)})` : ""}`,
    product.brand && `brand: ${product.brand}`,
    product.available ? undefined : "out of stock",
    product.url,
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");
}

export function formatCart(cart: Cart): string {
  if (cart.items.length === 0) return "The cart is empty";
  return [
    ...cart.items.map(
      (item) =>
        `${item.quantity} × ${item.product.title} (${item.product.id})  ${formatMoney(item.total)}`,
    ),
    ...(cart.delivery
      ? [
          `Subtotal: ${formatMoney(cart.subtotal)}`,
          `Delivery: ${formatMoney(cart.delivery)}`,
        ]
      : []),
    `Total: ${formatMoney(cart.total)}`,
  ].join("\n");
}

export function formatCheckout(provider: string, result: CheckoutResult) {
  if (result.status === "placed") {
    return [
      `Order ${result.order.id} placed: ${formatMoney(result.order.total)}`,
      ...(result.order.paymentUrl ? [`Pay at ${result.order.paymentUrl}`] : []),
      ...result.warnings.map((warning) => `warning: ${warning}`),
    ].join("\n");
  }
  const { preview, limits, spentToday } = result;
  return [
    formatCart(preview),
    ...(preview.address ? [`Address: ${formatAddress(preview.address)}`] : []),
    ...(preview.deliveryWindow
      ? [
          `Delivery window: ${preview.deliveryWindow.from} – ${preview.deliveryWindow.to}`,
        ]
      : []),
    ...(preview.payment ? [`Payment: ${preview.payment}`] : []),
    `Limits: ${formatMoney(limits.perOrder)} per order, ${formatMoney(spentToday)} of ${formatMoney(limits.perDay)} spent in the last 24 hours`,
    "",
    `To place the order (code valid until ${result.expiresAt}):`,
    `  ecom ${provider} checkout --confirm ${result.confirmationCode}`,
  ].join("\n");
}

function formatAddress(address: Address): string {
  return [
    address.city,
    address.line,
    address.apartment && `apt. ${address.apartment}`,
    address.comment && `(${address.comment})`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function formatOrders(page: Page<Order>): string {
  if (page.items.length === 0) return "No orders";
  return page.items.map(formatOrderLine).join("\n");
}

export function formatOrder(order: Order): string {
  return [
    formatOrderLine(order),
    ...order.items.map(
      (item) =>
        `  ${item.quantity} × ${item.product.title}  ${formatMoney(item.total)}`,
    ),
  ].join("\n");
}

function formatOrderLine(order: Order): string {
  return `${order.id}  ${order.status}  ${formatMoney(order.total)}  ${order.createdAt}`;
}
