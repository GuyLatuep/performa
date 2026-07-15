import { invoke } from "@tauri-apps/api/core";

export interface Myself {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
}

export interface CredentialsMeta {
  site: string;
  email: string;
}

export interface IssueSummary {
  key: string;
  summary: string;
}

export interface WorklogEntry {
  id: string;
  issueKey: string;
  issueSummary: string;
  timeSpentSeconds: number;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  comment: string;
}

export const api = {
  saveCredentials(site: string, email: string, token: string): Promise<Myself> {
    return invoke("save_credentials", { site, email, token });
  },
  credentialsStatus(): Promise<CredentialsMeta | null> {
    return invoke("credentials_status");
  },
  clearCredentials(): Promise<void> {
    return invoke("clear_credentials");
  },
  currentUser(): Promise<Myself> {
    return invoke("current_user");
  },
  searchIssues(jql: string): Promise<IssueSummary[]> {
    return invoke("search_issues", { jql });
  },
  logWork(
    issueKey: string,
    timeSpentSeconds: number,
    date: string,
    time: string,
    comment: string,
  ): Promise<void> {
    return invoke("log_work", { issueKey, timeSpentSeconds, date, time, comment });
  },
  updateWorklog(
    issueKey: string,
    worklogId: string,
    timeSpentSeconds: number,
    date: string,
    time: string,
    comment: string,
  ): Promise<void> {
    return invoke("update_worklog", {
      issueKey,
      worklogId,
      timeSpentSeconds,
      date,
      time,
      comment,
    });
  },
  deleteWorklog(issueKey: string, worklogId: string): Promise<void> {
    return invoke("delete_worklog", { issueKey, worklogId });
  },
  listWorklogs(start: string, end: string): Promise<WorklogEntry[]> {
    return invoke("list_worklogs", { start, end });
  },
};
