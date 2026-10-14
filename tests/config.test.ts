import { describe, expect, it } from "vitest";
import {
  AUTHORITY_SCORE,
  CONFIDENCE,
  CONFLICT,
  FUND_METRIC_DIRECTION,
  FUND_PROFILE_WEIGHTS,
  STOCK_METRIC_DIRECTION,
  STOCK_PROFILE_WEIGHTS,
  WATCH,
} from "../convex/config/engine.ts";
import { RANKING_PROFILES } from "../convex/engine/enums.ts";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("confidence settings", () => {
  it("positive weights add up to exactly 100%", () => {
    expect(sum(Object.values(CONFIDENCE.weights))).toBeCloseTo(1, 10);
  });

  it("score bands are in the right order", () => {
    expect(CONFIDENCE.bands.high).toBeGreaterThan(CONFIDENCE.bands.medium);
    expect(CONFIDENCE.bands.medium).toBeGreaterThan(0);
  });

  it("best case (all components = 1, no conflict) can reach 100", () => {
    expect(100 * sum(Object.values(CONFIDENCE.weights))).toBeCloseTo(100, 8);
  });

  it("more trusted sources score higher", () => {
    expect(AUTHORITY_SCORE.primary).toBeGreaterThan(AUTHORITY_SCORE.wire);
    expect(AUTHORITY_SCORE.wire).toBeGreaterThan(AUTHORITY_SCORE.trade);
    expect(AUTHORITY_SCORE.trade).toBeGreaterThan(AUTHORITY_SCORE.unknown);
  });
});

describe("conflict settings", () => {
  it("agree tolerance is smaller than the conflict threshold", () => {
    expect(CONFLICT.agreeTolerance).toBeLessThan(CONFLICT.conflictThreshold);
  });
});

describe("ranking weights", () => {
  for (const profile of RANKING_PROFILES) {
    it(`stock profile "${profile}" weights add up to 100%`, () => {
      expect(sum(Object.values(STOCK_PROFILE_WEIGHTS[profile]))).toBeCloseTo(1, 10);
    });

    it(`fund profile "${profile}" weights add up to 100%`, () => {
      expect(sum(Object.values(FUND_PROFILE_WEIGHTS[profile]))).toBeCloseTo(1, 10);
    });

    it(`stock profile "${profile}" only uses metrics that have a direction`, () => {
      for (const metric of Object.keys(STOCK_PROFILE_WEIGHTS[profile])) {
        expect(STOCK_METRIC_DIRECTION).toHaveProperty(metric);
      }
    });

    it(`fund profile "${profile}" only uses metrics that have a direction`, () => {
      for (const metric of Object.keys(FUND_PROFILE_WEIGHTS[profile])) {
        expect(FUND_METRIC_DIRECTION).toHaveProperty(metric);
      }
    });
  }
});

describe("watch settings", () => {
  it("every event type has an importance between 0 and 100", () => {
    for (const w of Object.values(WATCH.eventTypeWeight)) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(100);
    }
  });
});
