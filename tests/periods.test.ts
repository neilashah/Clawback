import { describe, expect, it } from "vitest";
import { anniversaryIn, benefitNextReset, benefitPeriod, cardYearStart, countsTowardFee, nextRenewal, ymd } from "@/lib/periods";
import type { Benefit } from "@/lib/types";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const plat = { renews_on: "2026-12-14" };
const delta = { renews_on: "2027-02-04" };
const brill = { renews_on: "2027-08-24" };
const star = { name: "Companion Certificate ✦", freq: "annual" as Benefit["freq"] };
const monthly = { name: "Resy credit", freq: "monthly" as Benefit["freq"] };
const annual = { name: "Delta Stays credit", freq: "annual" as Benefit["freq"] };

describe("renewal dates", () => {
  it("rolls the stored date forward or back by whole years", () => {
    const today = day(2026, 11, 17);
    expect(ymd(nextRenewal(plat.renews_on, today))).toBe("2026-12-14");
    expect(ymd(nextRenewal(delta.renews_on, today))).toBe("2027-02-04");
    expect(ymd(nextRenewal(brill.renews_on, today))).toBe("2027-08-24");
    expect(ymd(nextRenewal(plat.renews_on, day(2027, 3, 1)))).toBe("2027-12-14"); // past date rolls on
    expect(ymd(nextRenewal(plat.renews_on, day(2026, 12, 14)))).toBe("2026-12-14"); // renewal day = today
  });

  it("clamps Feb 29 to Feb 28 in non-leap years", () => {
    expect(ymd(anniversaryIn("2028-02-29", 2027))).toBe("2027-02-28");
    expect(ymd(anniversaryIn("2027-02-28", 2028))).toBe("2028-02-28");
  });

  it("card year starts at the last anniversary on or before the date", () => {
    expect(ymd(cardYearStart(delta.renews_on, day(2026, 11, 17)))).toBe("2026-02-04");
    expect(ymd(cardYearStart(delta.renews_on, day(2027, 2, 3)))).toBe("2026-02-04");
    expect(ymd(cardYearStart(delta.renews_on, day(2027, 2, 4)))).toBe("2027-02-04");
  });
});

describe("benefitPeriod / benefitNextReset", () => {
  it("✦ credits follow the card year, keyed by its start year", () => {
    expect(benefitPeriod(star, delta, day(2026, 11, 17))).toBe("2026");
    expect(benefitPeriod(star, delta, day(2027, 1, 20))).toBe("2026");
    expect(benefitPeriod(star, delta, day(2027, 2, 10))).toBe("2027");
    expect(benefitPeriod(star, plat, day(2026, 11, 17))).toBe("2025");
    expect(ymd(benefitNextReset(star, delta, day(2026, 11, 17)))).toBe("2027-02-04");
  });

  it("without a renewal date, or for non-✦ credits, stays on the calendar", () => {
    expect(benefitPeriod(star, { renews_on: null }, day(2027, 1, 20))).toBe("2027");
    expect(benefitPeriod(annual, delta, day(2027, 1, 20))).toBe("2027");
    expect(benefitPeriod(monthly, delta, day(2027, 1, 20))).toBe("2027-01");
    expect(ymd(benefitNextReset(monthly, delta, day(2027, 1, 20)))).toBe("2027-02-01");
  });
});

describe("countsTowardFee (card year, by middle of the period)", () => {
  const today = day(2026, 11, 17);
  it("Platinum (renews Dec 14): card year Dec 14 2025 – Dec 13 2026", () => {
    expect(countsTowardFee("2025-12", monthly, plat, today)).toBe(true);
    expect(countsTowardFee("2025-11", monthly, plat, today)).toBe(false);
    expect(countsTowardFee("2026", annual, plat, today)).toBe(true);
    expect(countsTowardFee("2025", annual, plat, today)).toBe(false);
    expect(countsTowardFee("2026-H2", { ...annual, freq: "semiannual" }, plat, today)).toBe(true);
  });

  it("Delta (renews Feb 4): card year Feb 4 2026 – Feb 3 2027", () => {
    expect(countsTowardFee("2026-01", monthly, delta, today)).toBe(false);
    expect(countsTowardFee("2026-02", monthly, delta, today)).toBe(true);
    expect(countsTowardFee("2026", annual, delta, today)).toBe(true);
    expect(countsTowardFee("2026", star, delta, today)).toBe(true);
    expect(countsTowardFee("2025", star, delta, today)).toBe(false);
  });

  it("Brilliant (renews Aug 24): card year Aug 24 2026 – Aug 23 2027", () => {
    expect(countsTowardFee("2026-08", monthly, brill, today)).toBe(false);
    expect(countsTowardFee("2026-09", monthly, brill, today)).toBe(true);
    expect(countsTowardFee("2026", star, brill, today)).toBe(true);
  });

  it("no renewal date: calendar year", () => {
    expect(countsTowardFee("2026-01", monthly, null, today)).toBe(true);
    expect(countsTowardFee("2025-12", monthly, null, today)).toBe(false);
    expect(countsTowardFee("2026", annual, null, today)).toBe(true);
  });
});
