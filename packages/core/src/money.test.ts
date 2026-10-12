import { describe, expect, test } from "bun:test";
import { EcomError } from "./errors.ts";
import {
  formatMoney,
  fromMajor,
  money,
  multiplyMoney,
  sumMoney,
} from "./money.ts";

describe("money", () => {
  test("keeps amounts in integer minor units", () => {
    expect(fromMajor(129.9)).toEqual({ amount: 12990, currency: "RUB" });
    expect(fromMajor(1.005)).toEqual(money(101));
    expect(fromMajor("3000")).toEqual(money(300000));
    expect(() => fromMajor(-1)).toThrow(EcomError);
    expect(() => fromMajor("1e3")).toThrow(EcomError);
    expect(() => money(1.5)).toThrow(EcomError);
  });

  test("sums and multiplies within one currency", () => {
    expect(sumMoney([money(100), money(250)])).toEqual(money(350));
    expect(multiplyMoney(money(12990), 3)).toEqual(money(38970));
    expect(() => sumMoney([money(100, "USD")])).toThrow(EcomError);
  });

  test("formats rubles", () => {
    expect(formatMoney(money(500000))).toBe("5 000 ₽");
    expect(formatMoney(money(12990))).toBe("129,90 ₽");
    expect(formatMoney(money(100, "USD"))).toBe("1 USD");
  });
});
