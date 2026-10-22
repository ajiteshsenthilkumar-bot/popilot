import { describe, expect, it } from "vitest";
import { addDays, diffDays, resolveEta, weekdayName } from "@/lib/dates";
import { TODAY } from "./helpers";

describe("dates", () => {
  it("knows today is Thursday", () => expect(weekdayName(TODAY)).toBe("thursday"));

  it("resolves 'Monday' to the next Monday", () => {
    expect(resolveEta({ type: "weekday", value: "monday" }, TODAY)).toBe("2026-10-26");
  });

  it("same weekday means next week, not today", () => {
    expect(resolveEta({ type: "weekday", value: "thursday" }, TODAY)).toBe("2026-10-29");
  });

  it("resolves relative days and absolute dates", () => {
    expect(resolveEta({ type: "relative_days", value: 3 }, TODAY)).toBe("2026-10-25");
    expect(resolveEta({ type: "absolute", value: "2026-11-02" }, TODAY)).toBe("2026-11-02");
  });

  it("rejects nonsense instead of guessing", () => {
    expect(resolveEta(null, TODAY)).toBeNull();
    expect(resolveEta({ type: "weekday", value: "someday" }, TODAY)).toBeNull();
    expect(resolveEta({ type: "absolute", value: "2026-02-31" }, TODAY)).toBeNull();
    expect(resolveEta({ type: "relative_days", value: -2 }, TODAY)).toBeNull();
    expect(resolveEta({ type: "relative_days", value: 1.5 }, TODAY)).toBeNull();
  });

  it("adds and diffs days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(diffDays("2026-10-22", "2026-10-29")).toBe(7);
  });
});
