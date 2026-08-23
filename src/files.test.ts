import { describe, expect, it } from "vitest";
import { formatBytes } from "./files";

describe("formatBytes", () => {
  it("shows plain bytes below a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("keeps one decimal place while the number is small", () => {
    expect(formatBytes(1024)).toBe("1.0 kB");
    expect(formatBytes(1536)).toBe("1.5 kB");
  });

  it("drops the decimal once it stops earning its place", () => {
    expect(formatBytes(1024 * 412)).toBe("412 kB");
  });

  it("climbs through the units", () => {
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
    // Stops at the largest unit rather than inventing one.
    expect(formatBytes(1024 ** 5)).toBe("1024 TB");
  });

  it("refuses to guess at a size that isn't one", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});
