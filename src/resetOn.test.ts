/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { useResetOn } from "./resetOn";

describe("useResetOn", () => {
  it("leaves the initial state alone on mount", () => {
    const reset = vi.fn();
    renderHook(() => useResetOn("a", reset));
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets once per change of key, and not on a re-render with the same one", () => {
    const reset = vi.fn();
    const { rerender } = renderHook(({ k }) => useResetOn(k, reset), {
      initialProps: { k: "a" },
    });
    rerender({ k: "b" });
    rerender({ k: "b" });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("hands back the reset state in the very render that saw the new key", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ k }) => {
        const [error, setError] = useState<string | null>("stale");
        useResetOn(k, () => setError(null));
        seen.push(`${k}:${error}`);
      },
      { initialProps: { k: "a" } },
    );
    seen.length = 0;
    rerender({ k: "b" });
    // The render that set it is thrown away and redone before anything commits,
    // so what reaches the screen never pairs the new key with the stale error.
    expect(seen[seen.length - 1]).toBe("b:null");
  });
});
