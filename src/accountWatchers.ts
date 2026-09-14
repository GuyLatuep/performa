import { useEffect } from "react";
import { api, CredentialsMeta } from "./api";
import {
  startMentionsPolling,
  stopMentionsPolling,
  useMentionsUnreadCount,
} from "./mentions";
import {
  startMissingPolling,
  stopMissingPolling,
  useMissingUnseenCount,
} from "./missing";
import { claimSearchesFor } from "./savedSearches";

/**
 * Everything that runs in the background for the signed-in account: the two
 * inbox watchers, the saved searches that belong to the account, and the app
 * icon's badge. Nothing while signed out.
 */
export function useAccountWatchers(creds: CredentialsMeta | null): void {
  // The badge on the app icon, which is the only indication that survives the
  // window being behind something else. Both inboxes feed it: it counts what
  // is waiting, not which tab it is waiting in.
  const waiting = useMentionsUnreadCount() + useMissingUnseenCount();
  useEffect(() => {
    api.setBadge(waiting > 0 ? waiting : null);
  }, [waiting]);

  // Watch for unlogged activity in the background while signed in.
  const signedIn = !!creds;
  useEffect(() => {
    if (!signedIn) return;
    startMissingPolling();
    return stopMissingPolling;
  }, [signedIn]);

  // Same for @-mentions — the tab badge has to be right before it is opened.
  // Keyed on the account rather than on `signedIn`: read and notified state
  // belongs to whoever's inbox it was collected from.
  const account = creds ? `${creds.site}|${creds.email}` : null;
  useEffect(() => {
    if (!account) return;
    startMentionsPolling(account);
    return stopMentionsPolling;
  }, [account]);

  // A saved search names a field by the name *this* site spells it with, so the
  // set belongs to the account rather than to the machine: on another Jira the
  // palette would otherwise offer searches for fields that site has never heard
  // of. Claimed beside the mentions inbox, which belongs to an account for the
  // same kind of reason.
  useEffect(() => {
    if (account) claimSearchesFor(account);
  }, [account]);
}
