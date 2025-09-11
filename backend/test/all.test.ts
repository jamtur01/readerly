import { describe, it, expect } from "vitest";

// Split tests live in separate files under backend/test/*.test.ts
// This file is kept as a minimal smoke suite to avoid duplicate definitions.
describe("smoke", () => {
  it("loads test runner", () => {
    expect(true).toBe(true);
  });
});
