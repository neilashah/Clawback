import { describe, expect, it } from "vitest";
import { claimUrlFromToken, splitAccessUrl, toTxnRow, windows } from "@/lib/simplefin";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("claimUrlFromToken", () => {
  it("accepts simplefin.org claim URLs", () => {
    expect(claimUrlFromToken(b64("https://bridge.simplefin.org/simplefin/claim/abc")).hostname).toBe("bridge.simplefin.org");
  });
  it("rejects other hosts and garbage", () => {
    expect(() => claimUrlFromToken(b64("https://evil.example.com/claim"))).toThrow(/simplefin.org/);
    expect(() => claimUrlFromToken(b64("http://bridge.simplefin.org/x"))).toThrow(/simplefin.org/);
    expect(() => claimUrlFromToken("not a token")).toThrow();
  });
});

describe("splitAccessUrl", () => {
  it("moves credentials into a Basic header", () => {
    const { base, auth } = splitAccessUrl("https://us%40r:p%3Ass@bridge.simplefin.org/simplefin");
    expect(base).toBe("https://bridge.simplefin.org/simplefin");
    expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString()).toBe("us@r:p:ss");
  });
});

describe("toTxnRow", () => {
  it("negates amounts (SimpleFIN + = money in) and skips pending", () => {
    const row = toTxnRow("u", "sf:c:a", { id: "t1", posted: 1793318400, amount: "25.00", description: "Platinum Digital Entertainment Credit" });
    expect(row).toMatchObject({ transaction_id: "sf:c:a:t1", account_id: "sf:c:a", amount: -25, date: "2026-10-30" });
    expect(toTxnRow("u", "k", { id: "t2", posted: 0, amount: "-5", description: "x" })).toBeNull();
    expect(toTxnRow("u", "k", { id: "t3", posted: 1, amount: "-5", description: "x", pending: true })).toBeNull();
  });
});

describe("windows", () => {
  it("splits a range into ≤60-day chunks covering it exactly", () => {
    const s = new Date("2026-01-01T00:00:00Z");
    const e = new Date("2026-11-10T00:00:00Z");
    const w = windows(s, e, 60);
    expect(w[0][0]).toEqual(s);
    expect(w[w.length - 1][1]).toEqual(e);
    expect(w.every(([a, b]) => b.getTime() - a.getTime() <= 60 * 86400000)).toBe(true);
  });
});
