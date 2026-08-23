import { useEffect, useState } from "react";
import { api, ProjectSummary } from "../api";
import {
  copyIgnoredStatuses,
  projectIgnoredStatuses,
  toggleIgnoredStatus,
  useIgnoredStatuses,
} from "../todoStatuses";

/** Which workflow statuses the todo tab leaves out, per project. Issues in a
 *  Done-category status are dropped by the query itself; this covers the ones
 *  that are still open but somebody else's move, which every Jira site names
 *  differently.
 *
 *  Most sites reuse the same statuses across projects, so the list carries a
 *  "copy to" — ticking the same boxes project by project is the tedious part
 *  of setting this up. */
export default function SettingsTodo() {
  const ignored = useIgnoredStatuses();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [project, setProject] = useState("");
  const [statuses, setStatuses] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.jiraProjects().then(
      (list) => {
        if (cancelled) return;
        setProjects(list);
        setProject(list[0]?.key ?? "");
      },
      (err) => {
        if (cancelled) return;
        setProjects([]);
        setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setStatuses(null);
    setError(null);
    // A copy is about the project that was on screen when it was opened.
    setCopying(false);
    setCopyTargets([]);
    setCopied(0);
    api.projectStatuses(project).then(
      (list) => {
        if (!cancelled) setStatuses(list);
      },
      (err) => {
        if (cancelled) return;
        setStatuses([]);
        setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project]);

  const hidden = projectIgnoredStatuses(ignored, project);
  // Statuses hidden here that the project no longer offers — a renamed or
  // retired one. Listed anyway, or there would be no way to untick it.
  const offered = statuses ?? [];
  const retired = hidden.filter((s) => !offered.includes(s));
  const others = projects?.filter((p) => p.key !== project) ?? [];

  function toggleTarget(key: string) {
    setCopied(0);
    setCopyTargets((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
    );
  }

  function copy() {
    copyIgnoredStatuses(project, copyTargets);
    setCopied(copyTargets.length);
    setCopying(false);
    setCopyTargets([]);
  }

  return (
    <>
      <div className="field-block">
        <span className="field-label">Project</span>
        <div className="hours-field">
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={!projects?.length}
          >
            {projects === null && <option>Loading…</option>}
            {projects?.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
          <span className="hint">
            each project keeps its own list · finished issues are always left
            out
          </span>
        </div>
      </div>

      <div className="settings-columns">
        <div className="field-block">
          <span className="field-label">Hide from the todo tab</span>
          {statuses === null && project && <p className="muted">Loading…</p>}
          {statuses?.length === 0 && !error && (
            <p className="muted">This project has no open statuses.</p>
          )}
          <div className="status-picker">
            {[...offered, ...retired].map((name) => (
              <label className="checkbox" key={name}>
                <input
                  type="checkbox"
                  checked={hidden.includes(name)}
                  onChange={() => toggleIgnoredStatus(project, name)}
                />
                <span>{name}</span>
              </label>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        {others.length > 0 && (
          <div className="field-block">
            <span className="field-label">Copy to</span>
            {!copying && (
              <div className="hours-field">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setCopied(0);
                    setCopying(true);
                  }}
                >
                  Copy to other projects…
                </button>
                <span className="hint">
                  {copied > 0
                    ? `copied to ${copied} project${copied === 1 ? "" : "s"}`
                    : `gives them the same ${hidden.length} status${
                        hidden.length === 1 ? "" : "es"
                      } as ${project}`}
                </span>
              </div>
            )}
            {copying && (
              <>
                <div className="status-picker">
                  {others.map((p) => (
                    <label className="checkbox" key={p.key}>
                      <input
                        type="checkbox"
                        checked={copyTargets.includes(p.key)}
                        onChange={() => toggleTarget(p.key)}
                      />
                      <span>
                        {p.key} · {p.name}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setCopying(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={copy}
                    disabled={copyTargets.length === 0}
                  >
                    Copy
                  </button>
                </div>
                <span className="hint">
                  replaces whatever those projects hide today
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
