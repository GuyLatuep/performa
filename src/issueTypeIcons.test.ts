/** @vitest-environment happy-dom */
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";

const KEY = "performa-issue-type-icons";
/** Mirrors the cap in the module under test. */
const LIMIT = 30;

const mockInvoke = vi.mocked(invoke);

const iconUrl = (n: number) => `https://jira.example/icons/type-${n}.png`;
const dataUrlFor = (url: string) => `data:image/png;base64,${url}`;

/** The cache reads localStorage once at import and then keeps its value in
 *  memory — and remembers failed URLs in a module-level set with no reset —
 *  so each case needs the module loaded afresh over its own seed. Re-importing
 *  also hands `api.ts` a fresh `memo` cache, which would otherwise replay one
 *  case's icon into the next. */
async function freshIcons(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined)
    localStorage.setItem(
      KEY,
      typeof seed === "string" ? seed : JSON.stringify(seed),
    );
  vi.resetModules();
  return import("./issueTypeIcons");
}

const persisted = (): Record<string, string> =>
  JSON.parse(localStorage.getItem(KEY) ?? "{}");

/** Only the icon fetches — `logged` puts a `frontend_log` call alongside
 *  each one. */
const iconCalls = () =>
  mockInvoke.mock.calls.filter(([command]) => command === "issue_type_icon");

/** Render the hook for one URL, with a `rerender` that points it at another. */
async function renderIcon(
  useIssueTypeIcon: (url?: string) => string | undefined,
  url: string | undefined,
) {
  return renderHook(({ u }: { u: string | undefined }) => useIssueTypeIcon(u), {
    initialProps: { u: url },
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command, args) =>
    command === "issue_type_icon"
      ? dataUrlFor((args as { url: string }).url)
      : undefined,
  );
});

describe("useIssueTypeIcon", () => {
  it("fetches an icon once and holds it for later askers", async () => {
    const { useIssueTypeIcon } = await freshIcons();
    const url = iconUrl(1);

    const first = await renderIcon(useIssueTypeIcon, url);
    // Undefined while it is on its way: the caller keeps the cell's space, so
    // an icon arriving late must not move the row.
    expect(first.result.current).toBeUndefined();
    await waitFor(() => expect(first.result.current).toBe(dataUrlFor(url)));

    // A second row of the same issue type is the common case — fifty issues
    // share three or four types — and must not cost a second fetch.
    const second = await renderIcon(useIssueTypeIcon, url);
    expect(second.result.current).toBe(dataUrlFor(url));
    expect(iconCalls()).toHaveLength(1);
  });

  it("asks for nothing when the caller has no URL", async () => {
    const { useIssueTypeIcon } = await freshIcons();

    const { result } = await renderIcon(useIssueTypeIcon, undefined);

    expect(result.current).toBeUndefined();
    expect(iconCalls()).toHaveLength(0);
  });

  it("starts warm from a previous run", async () => {
    // The whole point of persisting: rows are not blank for a moment on every
    // launch while the icons are refetched.
    const url = iconUrl(1);
    const { useIssueTypeIcon } = await freshIcons({ [url]: dataUrlFor(url) });

    const { result } = await renderIcon(useIssueTypeIcon, url);

    expect(result.current).toBe(dataUrlFor(url));
    expect(iconCalls()).toHaveLength(0);
  });

  it("survives whatever is in storage", async () => {
    for (const junk of ["not json", '"a string"', "42", "[1,2]", "null"]) {
      const url = iconUrl(1);
      const { useIssueTypeIcon } = await freshIcons(junk);

      const { result } = await renderIcon(useIssueTypeIcon, url);

      // Nothing usable was stored, so it refetches rather than throwing.
      await waitFor(() => expect(result.current).toBe(dataUrlFor(url)));
    }
  });

  it("ignores stored entries that are not data URLs", async () => {
    const good = iconUrl(1);
    const bad = iconUrl(2);
    const { useIssueTypeIcon } = await freshIcons({
      [good]: dataUrlFor(good),
      [bad]: 42,
    });

    const kept = await renderIcon(useIssueTypeIcon, good);
    expect(kept.result.current).toBe(dataUrlFor(good));

    const dropped = await renderIcon(useIssueTypeIcon, bad);
    expect(dropped.result.current).toBeUndefined();
    await waitFor(() => expect(dropped.result.current).toBe(dataUrlFor(bad)));
  });

  it("caps the cache, dropping the icons cached longest ago", async () => {
    // A long-lived install must not grow the entry without bound: a data URL
    // is a few kB and localStorage is not large.
    const { useIssueTypeIcon } = await freshIcons();

    const { result, rerender } = await renderIcon(useIssueTypeIcon, iconUrl(0));
    for (let n = 0; n <= LIMIT; n++) {
      rerender({ u: iconUrl(n) });
      await waitFor(() => expect(result.current).toBe(dataUrlFor(iconUrl(n))));
    }

    const stored = persisted();
    expect(Object.keys(stored)).toHaveLength(LIMIT);
    // The very first one asked for is the one that goes.
    expect(stored[iconUrl(0)]).toBeUndefined();
    expect(stored[iconUrl(1)]).toBe(dataUrlFor(iconUrl(1)));
    expect(stored[iconUrl(LIMIT)]).toBe(dataUrlFor(iconUrl(LIMIT)));
  });

  it("does not keep retrying an icon that cannot be fetched", async () => {
    // `api.issueTypeIcon` drops a failed call from its own memo so the next
    // caller gets a real retry; without the module's own record of failures
    // that would mean one request per mount for the rest of the session.
    const url = iconUrl(1);
    mockInvoke.mockImplementation(async (command) => {
      if (command === "issue_type_icon") throw new Error("404");
      return undefined;
    });
    const { useIssueTypeIcon } = await freshIcons();

    const first = await renderIcon(useIssueTypeIcon, url);
    await waitFor(() => expect(iconCalls()).toHaveLength(1));
    expect(first.result.current).toBeUndefined();
    first.unmount();

    const second = await renderIcon(useIssueTypeIcon, url);
    // Scrolling the list back and forth remounts the row; the failure stands.
    expect(second.result.current).toBeUndefined();
    expect(iconCalls()).toHaveLength(1);
  });

  it("still shows an icon it could not persist", async () => {
    // A full localStorage is not worth a broken row: the cache works for this
    // session, it just won't survive the restart.
    const { useIssueTypeIcon } = await freshIcons();
    const url = iconUrl(1);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = await renderIcon(useIssueTypeIcon, url);

    await waitFor(() => expect(result.current).toBe(dataUrlFor(url)));
    vi.mocked(localStorage.setItem).mockRestore();
    expect(persisted()).toEqual({});
  });
});
