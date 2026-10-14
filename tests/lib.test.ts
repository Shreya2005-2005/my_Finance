import { describe, expect, it } from "vitest";
import { checkNumbers, extractNumbers, extractYears, relativeDiff } from "../convex/engine/lib/numbers.ts";
import {
  backoffDelay,
  canCall,
  newBreaker,
  newBucket,
  recordFailure,
  recordSuccess,
  takeToken,
  withRetry,
} from "../convex/engine/lib/resilience.ts";
import { canonicalizeUrl, chunkText, fastHash, normalizeTitle, sha256Hex, similarity, stripHtml } from "../convex/engine/lib/text.ts";
import { classifyPublisher } from "../convex/engine/lib/authority.ts";
import { fail, ok, ProviderError } from "../convex/engine/providers/types.ts";

describe("number parsing (the crore / million trap)", () => {
  it("reads Indian grouping and crore", () => {
    const [n] = extractNumbers("Revenue was Rs 1,23,456 crore");
    expect(n!.value).toBe(123456 * 1e7);
  });
  it("100 crore is NOT 10 million", () => {
    const a = extractNumbers("100 crore")[0]!.value;
    const b = extractNumbers("10 million")[0]!.value;
    expect(a).toBe(1e9);
    expect(b).toBe(1e7);
    expect(a).not.toBe(b);
  });
  it("same amount written differently is equal", () => {
    expect(extractNumbers("₹1,000 crore")[0]!.value).toBe(extractNumbers("10 billion")[0]!.value);
    expect(extractNumbers("12 lakh")[0]!.value).toBe(1_200_000);
  });
  it("handles percent", () => {
    const n = extractNumbers("grew 12.5% year on year")[0]!;
    expect(n.value).toBe(12.5);
    expect(n.isPercent).toBe(true);
  });
  it("ignores plain years", () => {
    expect(extractNumbers("in 2025 the company")).toHaveLength(0);
  });
  it("checkNumbers catches a wrong figure", () => {
    expect(checkNumbers("Profit was 500 crore", "net profit of Rs 480 crore").allMatch).toBe(false);
    expect(checkNumbers("Profit was 500 crore", "net profit of Rs 500 crore").allMatch).toBe(true);
  });
  it("checkNumbers does not confuse percent with amount", () => {
    expect(checkNumbers("up 12%", "up 12 crore").allMatch).toBe(false);
  });
  it("finds years and FY labels", () => {
    expect(extractYears("FY2025 and FY26 results")).toEqual(expect.arrayContaining([2025, 2026]));
  });
  it("relativeDiff", () => {
    expect(relativeDiff(100, 100)).toBe(0);
    expect(relativeDiff(100, 120)).toBeCloseTo(1 / 6, 5);
    expect(relativeDiff(0, 0)).toBe(0);
  });
});

describe("text helpers", () => {
  it("canonicalizeUrl removes tracking junk", () => {
    expect(canonicalizeUrl("https://www.Example.com/a/b/?utm_source=x&id=5#top")).toBe("https://example.com/a/b?id=5");
    expect(canonicalizeUrl("https://example.com/a/")).toBe(canonicalizeUrl("https://example.com/a"));
  });
  it("normalizeTitle drops the publisher suffix", () => {
    expect(normalizeTitle("Tata Motors profit rises 12% - Reuters")).toBe(normalizeTitle("Tata Motors profit rises 12%"));
  });
  it("similarity: same wording ~1, different ~0", () => {
    expect(similarity("Tata Motors Q2 profit rises sharply", "Tata Motors Q2 profit rises sharply")).toBe(1);
    expect(similarity("Tata Motors Q2 profit rises sharply", "Infosys announces new campus in Pune")).toBeLessThan(0.1);
  });
  it("fastHash is stable and differs for different text", () => {
    expect(fastHash("abc")).toBe(fastHash("abc"));
    expect(fastHash("abc")).not.toBe(fastHash("abd"));
  });
  it("sha256 matches the known value", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("chunkText covers the whole text with overlap", () => {
    const text = "Sentence number one. ".repeat(200);
    const chunks = chunkText(text, 500, 100);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks[0]!.startChar).toBe(0);
    expect(chunks.at(-1)!.endChar).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.startChar).toBeLessThan(chunks[i - 1]!.endChar);
    for (const c of chunks) expect(text.slice(c.startChar, c.endChar)).toBe(c.text);
  });
  it("stripHtml", () => {
    expect(stripHtml("<p>A &amp; B&nbsp;<b>C</b></p>")).toBe("A & B C");
  });
  it("classifyPublisher", () => {
    expect(classifyPublisher("Reuters")).toBe("wire");
    expect(classifyPublisher("BSE announcement")).toBe("primary");
    expect(classifyPublisher("randomblog123.xyz")).toBe("unknown");
  });
});

describe("retry (chaos: temporary failures)", () => {
  const noWait = { sleep: async () => {}, random: () => 0 };

  it("retries temporary errors then succeeds", async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return calls < 3 ? fail(new ProviderError("RATE_LIMITED", "x", "slow")) : ok("done");
    }, noWait);
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });
  it("gives up after the maximum attempts", async () => {
    let calls = 0;
    const r = await withRetry(async () => (calls++, fail(new ProviderError("UNAVAILABLE", "x", "down"))), { ...noWait, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(calls).toBe(3);
  });
  it("does NOT retry permanent errors", async () => {
    let calls = 0;
    const r = await withRetry(async () => (calls++, fail(new ProviderError("AUTH", "x", "bad key"))), noWait);
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
  });
  it("respects Retry-After", async () => {
    const waits: number[] = [];
    let calls = 0;
    await withRetry(async () => (calls++, calls < 2 ? fail(new ProviderError("RATE_LIMITED", "x", "s", 3000)) : ok(1)), {
      sleep: async (ms) => void waits.push(ms),
      random: () => 0,
    });
    expect(waits[0]).toBe(3000);
  });
  it("backoff grows and is capped", () => {
    const o = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0 };
    expect(backoffDelay(0, o)).toBe(100);
    expect(backoffDelay(1, o)).toBe(200);
    expect(backoffDelay(10, o)).toBe(1000);
  });
});

describe("circuit breaker", () => {
  const cfg = { failuresToOpen: 3, coolDownMs: 1000 };
  it("opens after repeated failures and blocks calls", () => {
    let b = newBreaker();
    for (let i = 0; i < 3; i++) b = recordFailure(b, 0, cfg);
    expect(b.state).toBe("open");
    expect(canCall(b, 500, cfg).allowed).toBe(false);
  });
  it("allows one test call after the cool-down, then closes on success", () => {
    let b = newBreaker();
    for (let i = 0; i < 3; i++) b = recordFailure(b, 0, cfg);
    const c = canCall(b, 1500, cfg);
    expect(c.allowed).toBe(true);
    expect(c.next.state).toBe("half_open");
    expect(recordSuccess(c.next).state).toBe("closed");
  });
  it("a failed test call re-opens immediately", () => {
    let b = newBreaker();
    for (let i = 0; i < 3; i++) b = recordFailure(b, 0, cfg);
    const half = canCall(b, 1500, cfg).next;
    expect(recordFailure(half, 1500, cfg).state).toBe("open");
  });
});

describe("rate limiter", () => {
  const cfg = { capacity: 2, refillPerSecond: 1 };
  it("allows a burst, then makes callers wait", () => {
    let b = newBucket(cfg, 0);
    const a = takeToken(b, cfg, 0);
    const c = takeToken(a.next, cfg, 0);
    const d = takeToken(c.next, cfg, 0);
    expect(a.allowed && c.allowed).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.waitMs).toBe(1000);
  });
  it("refills over time", () => {
    const empty = { tokens: 0, updatedAt: 0 };
    expect(takeToken(empty, cfg, 1000).allowed).toBe(true);
  });
});
