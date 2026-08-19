import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter, originAllowed } from "../guard";

describe("createRateLimiter", () => {
  it("allows a burst up to capacity, then blocks", () => {
    const limiter = createRateLimiter({
      capacity: 3,
      refillPerSecond: 1,
      now: () => 0,
    });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("refills over time", () => {
    let t = 0;
    const limiter = createRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: () => t,
    });
    limiter.take("a");
    limiter.take("a");
    expect(limiter.take("a")).toBe(false);
    t = 1000;
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("keys are independent budgets", () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 0,
      now: () => 0,
    });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
  });

  it("evicts the oldest key past maxKeys instead of growing forever", () => {
    let t = 0;
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 0,
      maxKeys: 2,
      now: () => t,
    });
    limiter.take("a");
    t = 1;
    limiter.take("b");
    t = 2;
    limiter.take("c"); // evicts "a"
    expect(limiter.take("a")).toBe(true); // fresh bucket again
  });
});

describe("originAllowed", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("https://slotwave.example/api/tip", { headers });

  it("passes requests without origin or referer", () => {
    expect(originAllowed(req())).toBe(true);
  });

  it("passes same-host origin and referer", () => {
    expect(
      originAllowed(
        req({
          origin: "https://slotwave.example",
          referer: "https://slotwave.example/",
        }),
      ),
    ).toBe(true);
  });

  it("refuses a foreign origin", () => {
    expect(originAllowed(req({ origin: "https://evil.example" }))).toBe(false);
  });

  it("refuses a foreign referer", () => {
    expect(
      originAllowed(req({ referer: "https://evil.example/page" })),
    ).toBe(false);
  });

  it("refuses a malformed origin", () => {
    expect(originAllowed(req({ origin: "not a url" }))).toBe(false);
  });
});

describe("clientKey", () => {
  it("takes the first forwarded address", () => {
    const request = new Request("https://x.example", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientKey(request)).toBe("203.0.113.9");
  });

  it("falls back to local when unforwarded", () => {
    expect(clientKey(new Request("https://x.example"))).toBe("local");
  });
});
