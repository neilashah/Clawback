import { describe, expect, it } from "vitest";
import { csvToTxns, csvTxnIds, dedupeAgainst, parseCsv, toIsoDate } from "@/lib/csv";

const CHASE = `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
11/03/2026,11/04/2026,TRAVEL CREDIT $300/YEAR,,Adjustment,84.50,
11/02/2026,11/03/2026,"DELTA AIR LINES, ATLANTA",Travel,Sale,-84.50,
10/28/2026,10/28/2026,Payment Thank You-Mobile,,Payment,1200.00,
`;

const AMEX = `Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category
11/05/2026,Platinum Digital Entertainment Credit,-25.00,,,,,,,'320263090000000001',
11/01/2026,DISNEY PLUS 888-905-7888 CA,25.00,,,,,,,'320263090000000002',Entertainment
11/01/2026,ONLINE PAYMENT - THANK YOU,-500.00,,,,,,,'320263090000000003',
`;

describe("parseCsv", () => {
  it("handles quotes, commas, and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
    ]);
  });
});

describe("csvToTxns", () => {
  it("reads Chase: credits become negative, payments dropped", () => {
    const { format, txns } = csvToTxns(CHASE);
    expect(format).toBe("chase");
    expect(txns).toEqual([
      { date: "2026-11-04", amount: -84.5, description: "TRAVEL CREDIT $300/YEAR" },
      { date: "2026-11-03", amount: 84.5, description: "DELTA AIR LINES, ATLANTA" },
    ]);
  });

  it("reads Amex: signs kept (credits already negative)", () => {
    const { format, txns } = csvToTxns(AMEX);
    expect(format).toBe("amex");
    expect(txns[0]).toEqual({ date: "2026-11-05", amount: -25, description: "Platinum Digital Entertainment Credit" });
    expect(txns[1].amount).toBe(25);
    expect(txns).toHaveLength(3); // payment kept; isStatementCredit filters it later
  });

  it("rejects unknown formats", () => {
    expect(() => csvToTxns("foo,bar\n1,2\n")).toThrow(/Unrecognized CSV/);
  });
});

describe("toIsoDate", () => {
  it("normalizes common date formats", () => {
    expect(toIsoDate("1/5/26")).toBe("2026-01-05");
    expect(toIsoDate("2026-1-5")).toBe("2026-01-05");
    expect(toIsoDate("nope")).toBeNull();
  });
});

describe("csvTxnIds", () => {
  it("is stable across uploads and distinguishes identical rows", () => {
    const t = [
      { date: "2026-11-01", amount: 5, description: "Coffee" },
      { date: "2026-11-01", amount: 5, description: "Coffee" },
    ];
    const a = csvTxnIds("csv:x", t);
    expect(a[0]).not.toBe(a[1]);
    expect(csvTxnIds("csv:x", t)).toEqual(a);
  });
});

describe("dedupeAgainst", () => {
  it("drops rows matching a feed transaction by amount within 3 days, one-to-one", () => {
    const incoming = [
      { date: "2026-11-04", amount: -25 },
      { date: "2026-11-04", amount: -25 },
      { date: "2026-11-20", amount: -25 },
    ];
    expect(dedupeAgainst(incoming, [{ date: "2026-11-02", amount: -25 }])).toEqual([
      { date: "2026-11-04", amount: -25 },
      { date: "2026-11-20", amount: -25 },
    ]);
  });
});
