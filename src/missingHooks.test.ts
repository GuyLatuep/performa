/** @vitest-environment happy-dom */
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { MissingWorklog } from "./api";

// The store's own behaviour is covered in missing.test.ts, which runs without
// a DOM. This file is the hooks on top of it: each selects one field, so a
// check that only moves `lastChecked` re-renders the component showing that
// timestamp rather than every component watching for findings.

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => false,
  requestPermission: async () => "denied",
  sendNotification: () => {},
}));

const mockInvoke = vi.mocked(invoke);

const finding = (issueKey: string, activityAt: string): MissingWorklog => ({
  issueKey,
  issueSummary: "An issue",
  kind: "comment",
  detail: "said something",
  activityAt,
  logKey: issueKey,
  logSummary: "An issue",
});

function backendReturns(items: MissingWorklog[]) {
  mockInvoke.mockImplementation(async (command) =>
    command === "missing_worklogs" ? items : undefined,
  );
}

/** The store is seeded at import, so each case loads it afresh. */
async function freshMissing() {
  localStorage.clear();
  vi.resetModules();
  return import("./missing");
}

type Missing = Awaited<ReturnType<typeof freshMissing>>;

/** Render every hook at once and read them back. */
function watch(missing: Missing) {
  return renderHook(() => ({
    items: missing.useMissing(),
    unseen: missing.useMissingUnseenCount(),
    hidden: missing.useMissingHiddenCount(),
    error: missing.useMissingError(),
    lastChecked: missing.useMissingLastChecked(),
  })).result;
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("what the hooks hand out", () => {
  it("the findings, and how many are unseen or hidden", async () => {
    const missing = await freshMissing();
    const epic = finding("DEV-9", "2026-08-03T09:00:00+02:00");
    backendReturns([finding("DEV-1", "2026-08-03T10:00:00+02:00"), epic]);
    await missing.refreshMissing();
    missing.ignoreMissing(epic);

    const result = watch(missing);

    expect(result.current.items.map((i) => i.issueKey)).toEqual(["DEV-1"]);
    expect(result.current.unseen).toBe(1);
    expect(result.current.hidden).toBe(1);
    expect(result.current.error).toBeNull();
    expect(result.current.lastChecked).toMatch(/\d/);
  });

  it("the reason the last check came back empty-handed", async () => {
    const missing = await freshMissing();
    mockInvoke.mockImplementation(async (command) => {
      if (command === "missing_worklogs") throw new Error("offline");
      return undefined;
    });

    await missing.refreshMissing();
    const result = watch(missing);

    expect(result.current.error).toMatch(/offline/);
  });

  it("nothing unseen once the findings have been acknowledged", async () => {
    const missing = await freshMissing();
    backendReturns([
      finding("DEV-1", "2026-08-03T10:00:00+02:00"),
      finding("DEV-2", "2026-08-03T11:00:00+02:00"),
    ]);
    await missing.refreshMissing();
    const result = watch(missing);
    expect(result.current.unseen).toBe(2);

    await act(async () => {
      missing.markMissingSeen();
    });

    expect(result.current.unseen).toBe(0);
  });
});

describe("when the findings change underneath", () => {
  it("re-renders with the new ones", async () => {
    const missing = await freshMissing();
    backendReturns([]);
    await missing.refreshMissing();
    const result = watch(missing);
    expect(result.current.items).toHaveLength(0);

    backendReturns([finding("DEV-1", "2026-08-03T10:00:00+02:00")]);
    await act(async () => {
      await missing.refreshMissing("manual");
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("keeps the same array when a check finds nothing new", async () => {
    // The scan builds a fresh array every time; handing that to the store
    // would re-render every watching component on every check, forever.
    const missing = await freshMissing();
    backendReturns([finding("DEV-1", "2026-08-03T10:00:00+02:00")]);
    await missing.refreshMissing();
    const result = watch(missing);
    const first = result.current.items;

    backendReturns([finding("DEV-1", "2026-08-03T10:00:00+02:00")]);
    await act(async () => {
      await missing.refreshMissing("manual");
    });

    expect(result.current.items).toBe(first);
  });
});
