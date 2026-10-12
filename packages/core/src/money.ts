import { EcomError } from "./errors.ts";

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

const MINOR_UNITS = 100;

export function money(amount: number, currency = "RUB"): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new EcomError(
      "invalid_input",
      `Money amount must be an integer number of minor units, got ${amount}`,
    );
  }
  return { amount, currency };
}

export function fromMajor(major: number | string, currency = "RUB"): Money {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(major).trim());
  if (!match) {
    throw new EcomError(
      "invalid_input",
      `Expected a non-negative decimal amount, got ${JSON.stringify(major)}`,
    );
  }
  const [, whole = "0", fraction = ""] = match;
  const cents = Number(fraction.padEnd(3, "0").slice(0, 3));
  return money(Number(whole) * MINOR_UNITS + Math.round(cents / 10), currency);
}

export function sumMoney(items: readonly Money[], currency = "RUB"): Money {
  let amount = 0;
  for (const item of items) {
    if (item.currency !== currency) {
      throw new EcomError(
        "invalid_input",
        `Cannot add ${item.currency} to ${currency}`,
      );
    }
    amount += item.amount;
  }
  return money(amount, currency);
}

export function multiplyMoney(value: Money, factor: number): Money {
  return money(value.amount * factor, value.currency);
}

export function formatMoney(value: Money): string {
  const major = value.amount / MINOR_UNITS;
  const text = major.toLocaleString("ru-RU", {
    minimumFractionDigits: value.amount % MINOR_UNITS === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return value.currency === "RUB" ? `${text} ₽` : `${text} ${value.currency}`;
}
