import { describe, expect, it, vi } from "vitest";
import { WorklogInput } from "./api";
import { onWorklogFiled, reportWorklogFiled } from "./worklogEvents";

const WORKLOG: WorklogInput = {
  timeSpentSeconds: 3600,
  date: "2026-03-15",
  time: "09:00",
  comment: "",
  billable: true,
};

describe("onWorklogFiled", () => {
  it("hands the worklog to a subscriber", () => {
    const heard = vi.fn();
    const off = onWorklogFiled(heard);

    reportWorklogFiled(WORKLOG);

    expect(heard).toHaveBeenCalledWith(WORKLOG);
    off();
  });

  it("tells every subscriber, not just the first", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onWorklogFiled(first);
    const offSecond = onWorklogFiled(second);

    reportWorklogFiled(WORKLOG);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const heard = vi.fn();
    onWorklogFiled(heard)();

    reportWorklogFiled(WORKLOG);

    expect(heard).not.toHaveBeenCalled();
  });

  it("leaves the others subscribed when one unsubscribes", () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    const offStaying = onWorklogFiled(staying);
    onWorklogFiled(leaving)();

    reportWorklogFiled(WORKLOG);

    expect(staying).toHaveBeenCalledTimes(1);
    expect(leaving).not.toHaveBeenCalled();
    offStaying();
  });

  it("survives a subscriber unsubscribing while being told", () => {
    // A one-shot listener is the obvious way to write this, and removing from
    // a Set mid-iteration is exactly where a naive implementation drops the
    // next listener on the floor.
    const later = vi.fn();
    const off = onWorklogFiled(() => off());
    const offLater = onWorklogFiled(later);

    expect(() => reportWorklogFiled(WORKLOG)).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    offLater();
  });

  it("announces nothing to nobody without complaint", () => {
    expect(() => reportWorklogFiled(WORKLOG)).not.toThrow();
  });
});
