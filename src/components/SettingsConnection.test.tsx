/** @vitest-environment happy-dom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { apiMock, resetApiMock } from "../test-support/api";
import { CredentialsMeta } from "../api";
import SettingsConnection from "./SettingsConnection";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const existing: CredentialsMeta = {
  site: "team.atlassian.net",
  email: "anna@example.com",
} as CredentialsMeta;

function renderTab(
  props: Partial<Parameters<typeof SettingsConnection>[0]> = {},
) {
  const onSaved = vi.fn();
  render(<SettingsConnection existing={null} onSaved={onSaved} {...props} />);
  return onSaved;
}

const field = (name: RegExp) => screen.getByLabelText(name);

beforeEach(() => {
  resetApiMock();
  openUrl.mockClear();
});

describe("a first connection", () => {
  it("starts empty and offers to connect", () => {
    renderTab();

    expect((field(/Jira site/) as HTMLInputElement).value).toBe("");
    expect((field(/Email/) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Connect" })).toBeDefined();
  });

  it("keeps the token field required", () => {
    renderTab();

    expect(field(/API token/)).toHaveProperty("required", true);
  });

  it("hides the token as it is typed", () => {
    // It is a credential, and the settings screen is as shoulder-surfable as
    // any other.
    renderTab();

    expect(field(/API token/)).toHaveProperty("type", "password");
  });

  it("has no way out but connecting on first run", () => {
    // No onCancel: nothing else in the app works until this is set up.
    renderTab();

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("sends what was typed and reports back", async () => {
    const onSaved = renderTab();

    await userEvent.type(field(/Jira site/), "team.atlassian.net");
    await userEvent.type(field(/Email/), "anna@example.com");
    await userEvent.type(field(/API token/), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(apiMock.saveCredentials).toHaveBeenCalledWith(
        "team.atlassian.net",
        "anna@example.com",
        "s3cret",
      ),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("an existing connection", () => {
  it("fills in the site and email it already has", () => {
    renderTab({ existing });

    expect((field(/Jira site/) as HTMLInputElement).value).toBe(
      "team.atlassian.net",
    );
    expect((field(/Email/) as HTMLInputElement).value).toBe("anna@example.com");
  });

  it("never fills the token back in", () => {
    // The stored token is not readable here, and showing a fake one would
    // suggest it is.
    renderTab({ existing });

    expect((field(/API token/) as HTMLInputElement).value).toBe("");
    expect(field(/API token/)).toHaveProperty("required", false);
  });

  it("says the token can be left alone", () => {
    renderTab({ existing });

    expect((field(/API token/) as HTMLInputElement).placeholder).toMatch(
      /unchanged/,
    );
    expect(
      screen.getByText(/never sent to a different connection/),
    ).toBeDefined();
  });

  it("saves rather than connects", () => {
    renderTab({ existing });

    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("can be left without saving", async () => {
    const onCancel = vi.fn();
    renderTab({ existing, onCancel });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(apiMock.saveCredentials).not.toHaveBeenCalled();
  });
});

describe("while it is verifying", () => {
  it("says so and refuses a second submit", async () => {
    let finish!: () => void;
    apiMock.saveCredentials.mockImplementation(
      () => new Promise<void>((r) => (finish = () => r())),
    );
    renderTab({ existing });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const button = screen.getByRole("button", { name: "Verifying…" });
    expect(button).toHaveProperty("disabled", true);

    await userEvent.click(button);
    expect(apiMock.saveCredentials).toHaveBeenCalledTimes(1);
    finish();
  });
});

describe("when the credentials are rejected", () => {
  it("shows why and does not report success", async () => {
    apiMock.saveCredentials.mockRejectedValue(new Error("401 Unauthorized"));
    const onSaved = renderTab({ existing });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/401 Unauthorized/)).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("lets the details be corrected and tried again", async () => {
    apiMock.saveCredentials
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockResolvedValueOnce(undefined);
    const onSaved = renderTab({ existing });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/401 Unauthorized/);
    await userEvent.type(field(/API token/), "better-token");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // The stale failure is cleared rather than left under a successful save.
    expect(screen.queryByText(/401 Unauthorized/)).toBeNull();
  });
});

describe("submitting the form", () => {
  it("does not let the browser navigate away", async () => {
    // A form left to its own devices reloads the webview, which throws away
    // the whole app rather than saving anything.
    const { container } = render(
      <SettingsConnection existing={existing} onSaved={vi.fn()} />,
    );
    const form = container.querySelector("form")!;

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => {
      form.dispatchEvent(submit);
    });

    expect(submit.defaultPrevented).toBe(true);
  });
});

describe("getting a token", () => {
  it("opens Atlassian's page in a real browser", async () => {
    // The token page needs a real login session; the webview has none.
    renderTab();

    await userEvent.click(screen.getByText(/Create an API token/));

    expect(openUrl).toHaveBeenCalledWith(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
    );
  });

  it("does not submit the form on the way", async () => {
    renderTab();

    await userEvent.click(screen.getByText(/Create an API token/));

    expect(apiMock.saveCredentials).not.toHaveBeenCalled();
  });
});
