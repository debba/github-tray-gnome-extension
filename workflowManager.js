import GLib from "gi://GLib";
import { GitHubApi } from "./githubApi.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export class WorkflowManager {
  /**
   * @param {object} opts
   * @param {import('gi://Soup').Session} opts.httpSession
   * @param {import('gi://Gio').Settings} opts.settings
   * @param {function(string, string): void} opts.sendNotification
   * @param {function(): object[]} opts.getMonitoredRepos
   * @param {function(): boolean} opts.isMenuOpen
   */
  constructor({ httpSession, settings, sendNotification, getMonitoredRepos, isMenuOpen }) {
    this._httpSession = httpSession;
    this._settings = settings;
    this._sendNotification = sendNotification;
    this._getMonitoredRepos = getMonitoredRepos;
    this._isMenuOpen = isMenuOpen;

    // Map<repoFullName, workflowRuns[]>
    this._monitoredWorkflowRuns = new Map();
    this._rerunTimeout = null;
  }

  get monitoredWorkflowRuns() {
    return this._monitoredWorkflowRuns;
  }

  // Fetches workflow runs for a single repo (used by the UI on demand)
  async fetchForRepo(repo, callback) {
    const token = this._settings?.get_string("github-token");
    if (!token) {
      console.log(`[GitHubTray] No token available for fetching workflow runs`);
      callback([]);
      return;
    }

    try {
      const api = new GitHubApi(this._httpSession);
      const [owner, repoName] = repo.full_name.split("/");
      const maxRuns = this._settings.get_int("workflow-runs-max-display") || 10;
      console.log(
        `[GitHubTray] Fetching workflow runs for ${owner}/${repoName} (max: ${maxRuns})`,
      );
      const workflowRuns = await api.fetchRepoWorkflowRuns(
        token,
        owner,
        repoName,
        maxRuns,
      );
      console.log(
        `[GitHubTray] Fetched ${workflowRuns ? workflowRuns.length : 0} workflow runs for ${repo.full_name}`,
      );
      callback(workflowRuns);
    } catch (error) {
      console.error(
        `[GitHubTray] Error fetching workflow runs for ${repo.full_name}:`,
        error,
      );
      callback([]);
    }
  }

  // Loads workflow runs for all monitored repos and triggers change detection
  async loadMonitored() {
    const token = this._settings?.get_string("github-token");
    if (!token) return;

    const monitoredRepos = this._getMonitoredRepos();
    if (monitoredRepos.length === 0) return;

    console.log(
      `[GitHubTray] Loading workflow runs for ${monitoredRepos.length} monitored repos`,
    );

    const api = new GitHubApi(this._httpSession);

    for (const repo of monitoredRepos) {
      try {
        const [owner, repoName] = repo.full_name.split("/");
        const workflowRuns = await api.fetchRepoWorkflowRuns(
          token,
          owner,
          repoName,
          5,
        );

        const oldRuns = this._monitoredWorkflowRuns.get(repo.full_name) || [];
        this._monitoredWorkflowRuns.set(repo.full_name, workflowRuns);

        // Detect changes and notify
        if (oldRuns.length > 0) {
          this._detectChanges(workflowRuns, oldRuns, repo);
        }
      } catch (error) {
        console.error(
          `[GitHubTray] Error loading workflow runs for ${repo.full_name}:`,
          error,
        );
      }
    }
  }

  // Re-runs a failed workflow and refreshes after a short delay
  async rerun(workflowRun, callback) {
    const token = this._settings?.get_string("github-token");
    if (!token) {
      callback(false);
      return;
    }

    try {
      const api = new GitHubApi(this._httpSession);
      const [owner, repo] = workflowRun.repository_full_name.split("/");
      await api.rerunWorkflow(token, owner, repo, workflowRun.id);

      // Refresh monitored workflow runs after a short delay
      if (this._rerunTimeout) {
        GLib.source_remove(this._rerunTimeout);
        this._rerunTimeout = null;
      }
      this._rerunTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        this.loadMonitored();
        this._rerunTimeout = null;
        return GLib.SOURCE_REMOVE;
      });

      callback(true);
    } catch (error) {
      console.error(error, "GitHubTray:rerunWorkflow");
      callback(false);
    }
  }

  // Compares new and old workflow runs and sends desktop notifications for changes
  _detectChanges(newRuns, oldRuns, repo) {
    if (this._isMenuOpen()) return;

    const oldRunsMap = new Map(oldRuns.map((run) => [run.id, run]));

    for (const newRun of newRuns) {
      const oldRun = oldRunsMap.get(newRun.id);

      // New workflow started
      if (!oldRun && newRun.status === "in_progress") {
        if (this._settings.get_boolean("notify-workflow-started")) {
          this._sendNotification(
            _("GitHub Actions: Workflow Started"),
            `${repo.name} • ${newRun.name}\n${newRun.head_branch}`,
          );
        }
        continue;
      }

      // Workflow status changed
      if (oldRun && oldRun.status !== newRun.status) {
        if (newRun.status === "completed" && newRun.conclusion === "success") {
          if (this._settings.get_boolean("notify-workflow-success")) {
            const duration = this._getDuration(newRun);
            this._sendNotification(
              _("GitHub Actions: Workflow Succeeded"),
              `${repo.name} • ${newRun.name}\n${duration}`,
            );
          }
        } else if (
          newRun.status === "completed" &&
          newRun.conclusion === "failure"
        ) {
          if (this._settings.get_boolean("notify-workflow-failure")) {
            this._sendNotification(
              _("GitHub Actions: Workflow Failed"),
              `${repo.name} • ${newRun.name}\n${newRun.head_branch}`,
            );
          }
        } else if (
          newRun.status === "completed" &&
          newRun.conclusion === "cancelled"
        ) {
          if (this._settings.get_boolean("notify-workflow-cancelled")) {
            this._sendNotification(
              _("GitHub Actions: Workflow Cancelled"),
              `${repo.name} • ${newRun.name}`,
            );
          }
        }
      }
    }
  }

  // Returns a human-readable duration string for a workflow run
  _getDuration(run) {
    if (!run.run_started_at) return "";
    const start = GLib.DateTime.new_from_iso8601(run.run_started_at, null);
    const end = run.updated_at
      ? GLib.DateTime.new_from_iso8601(run.updated_at, null)
      : GLib.DateTime.new_now_utc();

    if (!start || !end) return "";

    const diffSec = end.to_unix() - start.to_unix();
    const minutes = Math.floor(diffSec / 60);
    const seconds = diffSec % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  destroy() {
    if (this._rerunTimeout) {
      GLib.source_remove(this._rerunTimeout);
      this._rerunTimeout = null;
    }
    this._monitoredWorkflowRuns.clear();
    this._httpSession = null;
    this._settings = null;
  }
}
