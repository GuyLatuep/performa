/** @vitest-environment happy-dom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { attachment, apiMock, resetApiMock } from "../test-support/api";
import IssueAttachments from "./IssueAttachments";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialog.open }));

/** The native drag-drop stream, which Tauri delivers outside the DOM. */
type DropPayload =
  { type: "over" } | { type: "drop"; paths: string[] } | { type: "leave" };

const webview = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: webview.onDragDropEvent }),
}));

const PLAN = attachment({ id: "a1", filename: "plan.pdf" });

function renderPanel(items = [PLAN]) {
  const onAttached = vi.fn();
  const view = render(
    <IssueAttachments
      issueKey="ABC-1"
      attachments={items}
      onAttached={onAttached}
    />,
  );
  return { onAttached, ...view };
}

/** Push one native drag-drop event at the panel. */
async function nativeDrop(payload: DropPayload) {
  const handler = webview.onDragDropEvent.mock.calls[0]?.[0] as (e: {
    payload: DropPayload;
  }) => void;
  await act(async () => {
    handler({ payload });
  });
}

/** A DOM drag event carrying the given `dataTransfer.types`. */
function dragEvent(name: "dragover" | "drop", types: string[]) {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  return event;
}

beforeEach(() => {
  resetApiMock();
  vi.clearAllMocks();
  webview.onDragDropEvent.mockResolvedValue(webview.unlisten);
  dialog.open.mockResolvedValue(null);
});

describe("the list", () => {
  it("shows a file with its size, author and age", () => {
    renderPanel([
      attachment({ filename: "plan.pdf", size: 2048, author: "Anna Leeson" }),
    ]);

    expect(screen.getByTitle("Open plan.pdf")).toBeDefined();
    expect(screen.getByText(/2\.0 kB · Anna Leeson/)).toBeDefined();
  });

  it("says so when the issue has no files", () => {
    renderPanel([]);

    expect(screen.getByText("No files on this issue.")).toBeDefined();
  });

  it("offers the download folder only once there is something in it", () => {
    const { unmount } = renderPanel([]);
    expect(screen.queryByText(/Open download folder/)).toBeNull();
    unmount();

    renderPanel([PLAN]);
    expect(screen.getByText(/Open download folder/)).toBeDefined();
  });

  it("opens the download folder on request", async () => {
    renderPanel();

    await userEvent.click(screen.getByText(/Open download folder/));

    expect(apiMock.openAttachmentFolder).toHaveBeenCalledTimes(1);
  });
});

describe("opening a file", () => {
  it("asks the backend for it by id and name", async () => {
    renderPanel();

    await userEvent.click(screen.getByTitle("Open plan.pdf"));

    expect(apiMock.openAttachment).toHaveBeenCalledWith("a1", "plan.pdf");
  });

  it("says it is opening, and locks the other files while it does", async () => {
    // Downloading to a scratch folder takes a moment; without this the row
    // looks like nothing happened and gets clicked again.
    let finish!: () => void;
    apiMock.openAttachment.mockImplementation(
      () => new Promise<void>((r) => (finish = () => r())),
    );
    renderPanel([PLAN, attachment({ id: "a2", filename: "notes.txt" })]);

    await userEvent.click(screen.getByTitle("Open plan.pdf"));

    expect(screen.getByText("Opening…")).toBeDefined();
    expect(screen.getByTitle("Open notes.txt")).toHaveProperty(
      "disabled",
      true,
    );

    await act(async () => finish());
    expect(screen.queryByText("Opening…")).toBeNull();
  });

  it("shows why it could not be opened", async () => {
    apiMock.openAttachment.mockRejectedValue(new Error("gone from Jira"));
    renderPanel();

    await userEvent.click(screen.getByTitle("Open plan.pdf"));

    expect(await screen.findByText(/Error: gone from Jira/)).toBeDefined();
    // Recoverable: the row goes back to being clickable.
    expect(screen.getByTitle("Open plan.pdf")).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("attaching by picker", () => {
  it("uploads what was picked", async () => {
    dialog.open.mockResolvedValue(["/tmp/a.png", "/tmp/b.png"]);
    const { onAttached } = renderPanel();

    await userEvent.click(screen.getByText("Attach files…"));

    await waitFor(() =>
      expect(apiMock.attachFiles).toHaveBeenCalledWith("ABC-1", [
        "/tmp/a.png",
        "/tmp/b.png",
      ]),
    );
    expect(onAttached).toHaveBeenCalledTimes(1);
  });

  it("takes a single file the dialog did not wrap in an array", async () => {
    dialog.open.mockResolvedValue("/tmp/only.png");
    renderPanel();

    await userEvent.click(screen.getByText("Attach files…"));

    await waitFor(() =>
      expect(apiMock.attachFiles).toHaveBeenCalledWith("ABC-1", [
        "/tmp/only.png",
      ]),
    );
  });

  it("does nothing when the dialog is dismissed", async () => {
    dialog.open.mockResolvedValue(null);
    const { onAttached } = renderPanel();

    await userEvent.click(screen.getByText("Attach files…"));

    expect(apiMock.attachFiles).not.toHaveBeenCalled();
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("shows why an upload failed, and stays usable", async () => {
    dialog.open.mockResolvedValue(["/tmp/a.png"]);
    apiMock.attachFiles.mockRejectedValue(new Error("file too large"));
    const { onAttached } = renderPanel();

    await userEvent.click(screen.getByText("Attach files…"));

    expect(await screen.findByText(/Error: file too large/)).toBeDefined();
    expect(onAttached).not.toHaveBeenCalled();
    expect(screen.getByText("Attach files…")).toHaveProperty("disabled", false);
  });
});

describe("attaching by dropping on the window", () => {
  it("highlights the panel while files are over it", async () => {
    const { container } = renderPanel();
    const panel = container.querySelector(".attachments")!;

    await nativeDrop({ type: "over" });
    expect(panel.className).toContain("dropping");

    await nativeDrop({ type: "leave" });
    expect(panel.className).not.toContain("dropping");
  });

  it("uploads the dropped paths and stops highlighting", async () => {
    const { onAttached, container } = renderPanel();

    await nativeDrop({ type: "over" });
    await nativeDrop({ type: "drop", paths: ["/tmp/shot.png"] });

    await waitFor(() =>
      expect(apiMock.attachFiles).toHaveBeenCalledWith("ABC-1", [
        "/tmp/shot.png",
      ]),
    );
    expect(onAttached).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".attachments")!.className).not.toContain(
      "dropping",
    );
  });

  it("ignores a drop that carried no files", async () => {
    renderPanel();

    await nativeDrop({ type: "drop", paths: [] });

    expect(apiMock.attachFiles).not.toHaveBeenCalled();
  });

  it("still works as a picker when the drop listener is unavailable", async () => {
    // Drag-and-drop is the convenience path, not the only one.
    webview.onDragDropEvent.mockRejectedValue(new Error("no webview"));
    dialog.open.mockResolvedValue(["/tmp/a.png"]);
    renderPanel();
    await act(async () => {});

    await userEvent.click(screen.getByText("Attach files…"));

    await waitFor(() => expect(apiMock.attachFiles).toHaveBeenCalled());
  });

  it("stops listening for drops once it unmounts", async () => {
    const { unmount } = renderPanel();
    await act(async () => {});

    unmount();

    expect(webview.unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not leave a listener behind when it unmounts mid-registration", async () => {
    // The listener arrives through a promise; unmounting before it resolves
    // must still take it back off.
    let arrive!: () => void;
    webview.onDragDropEvent.mockReturnValue(
      new Promise((r) => (arrive = () => r(webview.unlisten))),
    );
    const { unmount } = renderPanel();

    unmount();
    await act(async () => arrive());

    expect(webview.unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("the webview's own idea of a dropped file", () => {
  it("is suppressed for files", () => {
    // Over a text field WebKit shows a caret and the file's name, as if
    // dropping would paste it. It would not — the file gets attached.
    renderPanel();

    const over = dragEvent("dragover", ["Files"]);
    window.dispatchEvent(over);

    expect(over.defaultPrevented).toBe(true);
  });

  it("leaves ordinary text dragging alone", () => {
    // Dragging selected text within a textarea is ordinary editing.
    renderPanel();

    const over = dragEvent("dragover", ["text/plain"]);
    window.dispatchEvent(over);

    expect(over.defaultPrevented).toBe(false);
  });

  it("stops suppressing once it unmounts", () => {
    const { unmount } = renderPanel();
    unmount();

    const over = dragEvent("drop", ["Files"]);
    window.dispatchEvent(over);

    expect(over.defaultPrevented).toBe(false);
  });
});

describe("deleting a file", () => {
  const removeButton = () =>
    screen.getByTitle("Delete plan.pdf from this issue");

  it("takes two clicks, the second one labelled", async () => {
    // Irreversible, and it removes the file for everyone on the issue.
    renderPanel();

    await userEvent.click(removeButton());

    expect(screen.getByText("Delete for everyone?")).toBeDefined();
    expect(apiMock.deleteAttachment).not.toHaveBeenCalled();
  });

  it("deletes on the second click", async () => {
    const { onAttached } = renderPanel();

    await userEvent.click(removeButton());
    await userEvent.click(screen.getByTitle("Delete plan.pdf from this issue"));

    await waitFor(() =>
      expect(apiMock.deleteAttachment).toHaveBeenCalledWith("a1"),
    );
    expect(onAttached).toHaveBeenCalledTimes(1);
    // The confirmation is spent. The parent refetches and the row usually goes
    // with it, but a row that outlives the delete must not still be sitting
    // there asking.
    await waitFor(() =>
      expect(screen.queryByText("Delete for everyone?")).toBeNull(),
    );
  });

  it("backs out when the file is kept", async () => {
    renderPanel();
    await userEvent.click(removeButton());

    await userEvent.click(screen.getByTitle("Keep the file"));

    expect(screen.queryByText("Delete for everyone?")).toBeNull();
    expect(apiMock.deleteAttachment).not.toHaveBeenCalled();
  });

  it("shows why a delete failed and leaves the file listed", async () => {
    apiMock.deleteAttachment.mockRejectedValue(new Error("no permission"));
    const { onAttached } = renderPanel();

    await userEvent.click(removeButton());
    await userEvent.click(screen.getByTitle("Delete plan.pdf from this issue"));

    expect(await screen.findByText(/Error: no permission/)).toBeDefined();
    expect(onAttached).not.toHaveBeenCalled();
    // Still confirming, so a retry does not start from the beginning.
    expect(screen.getByText("Delete for everyone?")).toBeDefined();
  });
});
