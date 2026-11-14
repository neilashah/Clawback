import { describe, expect, it } from "vitest";
import { isFullyUsed, isPartlyUsed, remaining, usedAmount } from "@/lib/usage";

const hotel = { value: 300 };
const cert = { value: 0 };
const c = (amount: number | null, dismissed = false) => ({ amount, dismissed });

describe("usage helpers", () => {
  it("treats no claim and dismissed claims as unused", () => {
    for (const x of [undefined, null, c(null, true), c(120, true)]) {
      expect(usedAmount(x, hotel)).toBe(0);
      expect(remaining(x, hotel)).toBe(300);
      expect(isFullyUsed(x, hotel)).toBe(false);
      expect(isPartlyUsed(x, hotel)).toBe(false);
    }
  });

  it("amount null means fully used", () => {
    expect(usedAmount(c(null), hotel)).toBe(300);
    expect(isFullyUsed(c(null), hotel)).toBe(true);
    expect(remaining(c(null), hotel)).toBe(0);
  });

  it("partial amounts leave the rest available", () => {
    expect(usedAmount(c(120), hotel)).toBe(120);
    expect(remaining(c(120), hotel)).toBe(180);
    expect(isPartlyUsed(c(120), hotel)).toBe(true);
    expect(isFullyUsed(c(120), hotel)).toBe(false);
  });

  it("caps at the benefit value and reaching it counts as fully used", () => {
    expect(usedAmount(c(450), hotel)).toBe(300);
    expect(isFullyUsed(c(300), hotel)).toBe(true);
    expect(isPartlyUsed(c(300), hotel)).toBe(false);
  });

  it("$0 benefits are simply claimed or not", () => {
    expect(isFullyUsed(c(null), cert)).toBe(true);
    expect(isFullyUsed(undefined, cert)).toBe(false);
    expect(usedAmount(c(null), cert)).toBe(0);
    expect(isPartlyUsed(c(null), cert)).toBe(false);
  });
});
