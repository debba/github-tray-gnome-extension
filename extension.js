import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import { GitHubApi } from "./githubApi.js";
import { GitHubTrayUI } from "./ui.js";
import { detectChanges, detectNewFollowers } from "./utils.js";

export default class GitHubTrayExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._httpSession = new Soup.Session();
    this._lastRepos = null;
    this._lastFollowers = null;
    this._lastNotifications = [];
    this._monitoredWorkflowRuns = new Map(); // Map<repoFullName, workflowRuns[]>
    this._unreadCount = 0;
    this._isLoading = false;
    this._pendingUpdate = null;
    this._detectChangesTimeoutId = null;

    this._createIndicator();
    this._waitForNetworkAndLoad();
    this._setupAutoRefresh();
    this._setupNotificationRefresh();
    this._setupMonitoredWorkflowRefresh();
    this._setupSettingsListener();
  }

  disable() {
    this._cleanupTimers();
    this._disconnectSignals();
    this._destroyIndicator();
    this._cleanupState();
  }

  // UI Creation
  _createIndicator() {
    this._indicator = new PanelMenu.Button(0.0, "GitHub Tray");

    // GitHub icon
    const iconPath = `${this.path}/ui/icons/github-symbolic.svg`;
    const gicon = Gio.Icon.new_for_string(iconPath);
    this._icon = new St.Icon({
      gicon: gicon,
      style_class: "system-status-icon",
    });

    const iconBox = new St.BoxLayout({
      style: "spacing: 0px; padding: 0 2px;",
    });
    iconBox.add_child(this._icon);

    // Notification badge - DISABLED (breaks top menu bar)
    // this._badge = new St.Label({
    //   style_class: "github-tray-badge",
    //   text: "",
    //   visible: false,
    // });
    // iconBox.add_child(this._badge);

    this._indicator.add_child(iconBox);

    // Build UI
    this._ui = new GitHubTrayUI(
      this._indicator,
      this._settings,
      this._httpSession,
    );
    this._ui.setBadgeWidget(null); // this._badge);
    const { debugBtn } = this._ui.buildMenu(
      () => this._loadRepositories(true),
      () => {
        this.openPreferences();
        this._indicator.menu.close();
      },
      () => this._onDebugClick(),
      (repo, callback) => this._fetchRepoIssues(repo, callback),
      (notification, callback) =>
        this._markNotificationRead(notification, callback),
      (workflowRun, callback) => this._rerunWorkflow(workflowRun, callback),
      (repo, callback) => this._fetchRepoWorkflowRuns(repo, callback),
      () => this._loadNotifications(),
    );
    this._debugBtn = debugBtn;

    // Menu open state handler
    this._menuOpenChangedId = this._indicator.menu.connect(
      "open-state-changed",
      (_menu, open) => {
        if (!open) {
          this._handleMenuClose();
        }
      },
    );

    // Add to panel
    const panelBox = this._settings.get_string("panel-box") || "right";
    Main.panel.addToStatusArea("github-tray", this._indicator, 0, panelBox);
  }

  // Data Loading
  async _loadRepositories(manualRefresh = false) {
    if (this._isLoading || !this._indicator) return;

    const token = this._settings?.get_string("github-token");
    const username = this._settings?.get_string("github-username");

    if (!token || !username) {
      this._ui.showMessage(_("Configure token and username in Settings"));
      return;
    }

    this._isLoading = true;
    const wasOpen = this._indicator.menu.isOpen;

    if (!this._indicator.menu.isOpen) {
      this._ui.showMessage(_("Loading repositories..."));
    }

    try {
      const api = new GitHubApi(this._httpSession);
      const [repos, userInfo, followers] = await Promise.all([
        api.fetchRepositories(token, username, this._settings),
        api.fetchUserInfo(token, username),
        api.fetchFollowers(token),
      ]);

      if (!this._indicator) return;

      api.sortRepositories(repos, this._settings);

      const oldRepos = this._lastRepos;
      const oldFollowers = this._lastFollowers;
      this._lastRepos = repos;
      this._lastFollowers = followers;

      this._handleRepoUpdate(repos, username, userInfo, wasOpen, manualRefresh);

      // Load workflow runs for monitored repos (first time only)
      if (!oldRepos) {
        this._loadMonitoredWorkflowRuns();
      }

      if (oldRepos) {
        this._scheduleChangeDetection(repos, oldRepos, followers, oldFollowers);
      }
    } catch (error) {
      console.error(error, "GitHubTray");
      if (this._indicator) {
        this._ui.showMessage(_("Error loading repositories"));
        Main.notifyError(
          _("GitHub Tray"),
          _("Failed to fetch repositories: %s").format(error.message),
        );
      }
    } finally {
      this._isLoading = false;
    }
  }

  async _fetchRepoIssues(repo, callback) {
    const token = this._settings?.get_string("github-token");
    if (!token) {
      callback([]);
      return;
    }

    try {
      const api = new GitHubApi(this._httpSession);
      const [owner, repoName] = repo.full_name.split("/");
      const issues = await api.fetchRepoIssues(token, owner, repoName);
      callback(issues);
    } catch (error) {
      console.error(error, "GitHubTray:fetchIssues");
      callback([]);
    }
  }

  async _fetchRepoWorkflowRuns(repo, callback) {
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

  _getLocalPath(repoFullName) {
    try {
      const localProjectsJson = this._settings.get_string("local-projects");
      const localProjects = JSON.parse(localProjectsJson);
      return localProjects[repoFullName] || null;
    } catch (e) {
      return null;
    }
  }

  _getMonitoredRepos() {
    if (!this._lastRepos) return [];
    return this._lastRepos.filter(
      (repo) => this._getLocalPath(repo.full_name) !== null,
    );
  }

  _handleRepoUpdate(repos, username, userInfo, wasOpen, manualRefresh) {
    const notifications = this._lastNotifications || [];
    if (manualRefresh && wasOpen) {
      this._pendingUpdate = { repos, username, userInfo, notifications };
      this._indicator.menu.close();
      if (this._menuReopenTimeout) {
        GLib.source_remove(this._menuReopenTimeout);
        this._menuReopenTimeout = null;
      }
      this._menuReopenTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        400,
        () => {
          this._menuReopenTimeout = null;
          if (this._indicator) {
            this._indicator.menu.open();
          }
          return GLib.SOURCE_REMOVE;
        },
      );
    } else if (!this._indicator.menu.isOpen) {
      this._ui.updateMenu(repos, username, userInfo, notifications);
    } else {
      this._pendingUpdate = { repos, username, userInfo, notifications };
    }
  }

  _scheduleChangeDetection(newRepos, oldRepos, newFollowers, oldFollowers) {
    if (this._detectChangesTimeoutId) {
      GLib.source_remove(this._detectChangesTimeoutId);
      this._detectChangesTimeoutId = null;
    }
    this._detectChangesTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      100,
      () => {
        this._detectChangesTimeoutId = null;
        if (this._indicator) {
          this._detectAndNotify(newRepos, oldRepos, newFollowers, oldFollowers);
        }
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _detectAndNotify(newRepos, oldRepos, newFollowers, oldFollowers) {
    const changes = detectChanges(newRepos, oldRepos);
    if (!changes || !this._indicator || this._indicator.menu.isOpen) return;

    if (changes.totalNewStars > 0) {
      const starsMsg = changes.starsGained
        .map((item) => `${item.name} +${item.diff} ⭐`)
        .join("\n");
      this._sendNotification(_("New Stars!"), starsMsg);
    }

    if (changes.newIssues.length > 0) {
      const issuesMsg = changes.newIssues
        .map(
          (item) =>
            `${item.name} +${item.diff} issue${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");
      this._sendNotification(_("New Issues Opened"), issuesMsg);
    }

    if (changes.newForks.length > 0) {
      const forksMsg = changes.newForks
        .map(
          (item) =>
            `${item.name} +${item.diff} fork${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");
      this._sendNotification(_("New Forks Created"), forksMsg);
    }

    // Detect new followers
    const newFollowersList = detectNewFollowers(newFollowers, oldFollowers);
    if (newFollowersList && newFollowersList.length > 0) {
      let followersMsg;
      if (newFollowersList.length === 1) {
        followersMsg = newFollowersList[0].login;
      } else {
        followersMsg = `+${newFollowersList.length} followers`;
      }
      this._sendNotification(_("New Followers"), followersMsg);
    }
  }

  _detectWorkflowChanges(newRuns, oldRuns, repo) {
    if (!this._indicator || this._indicator.menu.isOpen) return;

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
        // Completed successfully
        if (newRun.status === "completed" && newRun.conclusion === "success") {
          if (this._settings.get_boolean("notify-workflow-success")) {
            const duration = this._getWorkflowDuration(newRun);
            this._sendNotification(
              _("GitHub Actions: Workflow Succeeded"),
              `${repo.name} • ${newRun.name}\n${duration}`,
            );
          }
        }
        // Failed
        else if (
          newRun.status === "completed" &&
          newRun.conclusion === "failure"
        ) {
          if (this._settings.get_boolean("notify-workflow-failure")) {
            this._sendNotification(
              _("GitHub Actions: Workflow Failed"),
              `${repo.name} • ${newRun.name}\n${newRun.head_branch}`,
            );
          }
        }
        // Cancelled
        else if (
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

  _getWorkflowDuration(run) {
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

  _sendNotification(summary, body) {
    if (!summary || !body) return;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      try {
        Main.notify(summary, body);
      } catch (e) {
        console.error(e, "GitHubTray:notify");
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  // Event Handlers
  _onDebugClick() {
    if (this._lastRepos && this._lastRepos.length >= 1) {
      const oldRepos = this._lastRepos;
      const oldFollowers = this._lastFollowers || [];
      const username = this._settings.get_string("github-username");

      const modifiedRepos = this._lastRepos.map((r, i) => {
        if (i < 3 && i < this._lastRepos.length) {
          const clone = { ...r };
          if (Math.random() > 0.5) {
            clone.stargazers_count += Math.floor(Math.random() * 5) + 1;
          }
          if (Math.random() > 0.7) {
            clone.open_issues_count += Math.floor(Math.random() * 3) + 1;
          }
          if (Math.random() > 0.8) {
            clone.forks_count += Math.floor(Math.random() * 2) + 1;
          }
          return clone;
        }
        return r;
      });

      // Add mock new followers for testing
      const newFollowers = [...oldFollowers];
      const numNewFollowers =
        Math.random() > 0.5 ? 1 : Math.floor(Math.random() * 3) + 2;
      for (let i = 0; i < numNewFollowers; i++) {
        newFollowers.push({
          id: Date.now() + i,
          login: `test_follower_${Date.now() + i}`,
        });
      }

      this._lastRepos = modifiedRepos;
      this._lastFollowers = newFollowers;
      this._pendingUpdate = {
        repos: modifiedRepos,
        username,
        userInfo: null,
      };
      this._pendingDetectChanges = {
        newRepos: modifiedRepos,
        oldRepos,
        newFollowers,
        oldFollowers,
      };

      this._indicator.menu.close();
    } else {
      this._indicator.menu.close();
    }
  }

  _handleMenuClose() {
    if (this._pendingUpdate || this._pendingDetectChanges) {
      if (this._menuCloseTimeout) {
        GLib.source_remove(this._menuCloseTimeout);
        this._menuCloseTimeout = null;
      }
      this._menuCloseTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        300,
        () => {
          this._menuCloseTimeout = null;
          if (!this._indicator) return GLib.SOURCE_REMOVE;

          if (this._pendingUpdate) {
            const { repos, username, userInfo, notifications } =
              this._pendingUpdate;
            this._pendingUpdate = null;
            this._ui.updateMenu(
              repos,
              username,
              userInfo,
              notifications || this._lastNotifications || [],
            );
          }

          if (this._pendingDetectChanges) {
            const { newRepos, oldRepos, newFollowers, oldFollowers } =
              this._pendingDetectChanges;
            this._pendingDetectChanges = null;
            this._detectAndNotify(
              newRepos,
              oldRepos,
              newFollowers,
              oldFollowers,
            );
          }

          return GLib.SOURCE_REMOVE;
        },
      );
    }
  }

  // Settings & Auto-refresh
  _setupAutoRefresh() {
    this._refreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      300,
      () => {
        this._loadRepositories();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _setupNotificationRefresh() {
    if (!this._settings.get_boolean("show-notifications")) return;

    this._loadNotifications();
    const interval = this._settings.get_int("notification-interval");
    this._notificationRefreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      interval,
      () => {
        if (this._settings.get_boolean("show-notifications")) {
          this._loadNotifications();
        }
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _setupMonitoredWorkflowRefresh() {
    // Refresh monitored workflows every 5 minutes
    const interval = 300; // 5 minutes
    this._monitoredWorkflowRefreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      interval,
      () => {
        this._loadMonitoredWorkflowRuns();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  async _loadMonitoredWorkflowRuns() {
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
          this._detectWorkflowChanges(workflowRuns, oldRuns, repo);
        }
      } catch (error) {
        console.error(
          `[GitHubTray] Error loading workflow runs for ${repo.full_name}:`,
          error,
        );
      }
    }
  }

  async _loadNotifications() {
    const token = this._settings?.get_string("github-token");
    if (!token) return;

    try {
      const api = new GitHubApi(this._httpSession);
      let notifications = await api.fetchNotifications(token);

      notifications = this._filterNotifications(notifications);
      const unreadCount = notifications.filter((n) => n.unread).length;

      const oldUnreadCount = this._unreadCount;
      this._lastNotifications = notifications;
      this._unreadCount = unreadCount;

      if (this._badge) {
        this._ui.updateBadge(unreadCount);
      }

      if (
        unreadCount > oldUnreadCount &&
        this._settings.get_boolean("desktop-notifications")
      ) {
        const newCount = unreadCount - oldUnreadCount;
        if (newCount > 0) {
          this._sendNotification(
            _("GitHub Notifications"),
            ngettext(
              "%d new notification",
              "%d new notifications",
              newCount,
            ).format(newCount),
          );
        }
      }

      if (
        this._pendingUpdate &&
        this._indicator &&
        !this._indicator.menu.isOpen
      ) {
        const { repos, username, userInfo } = this._pendingUpdate;
        this._pendingUpdate = null;
        this._ui.updateMenu(repos, username, userInfo, notifications);
      }
    } catch (error) {
      console.error(error, "GitHubTray:loadNotifications");
    }
  }

  _filterNotifications(notifications) {
    return notifications.filter((n) => {
      const reason = n.reason;
      const type = n.subject.type;

      if (reason === "review_requested") {
        return this._settings.get_boolean("notify-review-requests");
      }
      if (reason === "mention" || reason === "team_mention") {
        return this._settings.get_boolean("notify-mentions");
      }
      if (reason === "assign") {
        return this._settings.get_boolean("notify-assignments");
      }
      if (
        type === "PullRequest" ||
        type === "PullRequestReview" ||
        type === "PullRequestReviewComment"
      ) {
        return this._settings.get_boolean("notify-pr-comments");
      }
      if (type === "Issue" || type === "IssueComment") {
        return this._settings.get_boolean("notify-issue-comments");
      }
      return true;
    });
  }

  async _markNotificationRead(notification, callback) {
    const token = this._settings?.get_string("github-token");
    if (!token) {
      callback();
      return;
    }

    try {
      const api = new GitHubApi(this._httpSession);
      await api.markNotificationRead(token, notification.id);

      this._lastNotifications = this._lastNotifications.filter(
        (n) => n.id !== notification.id,
      );
      this._unreadCount = Math.max(0, this._unreadCount - 1);
      this._ui.updateBadge(this._unreadCount);

      callback();
    } catch (error) {
      console.error(error, "GitHubTray:markNotificationRead");
      callback();
    }
  }

  async _rerunWorkflow(workflowRun, callback) {
    const token = this._settings?.get_string("github-token");
    if (!token) {
      callback(false);
      return;
    }

    try {
      const api = new GitHubApi(this._httpSession);
      const [owner, repo] = workflowRun.repository_full_name.split("/");
      await api.rerunWorkflow(token, owner, repo, workflowRun.id);

      // Refresh workflow runs after a short delay
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        this._loadWorkflowRuns();
        return GLib.SOURCE_REMOVE;
      });

      callback(true);
    } catch (error) {
      console.error(error, "GitHubTray:rerunWorkflow");
      callback(false);
    }
  }

  _setupSettingsListener() {
    this._settingsDebounceId = null;
    this._settingsChangedId = this._settings.connect(
      "changed",
      (_settings, key) => {
        if (key === "debug-mode" && this._ui) {
          this._ui.updateDebugButtonVisibility();
          return;
        }

        // Handle panel position change
        if (key === "panel-box") {
          this._updatePanelPosition();
          return;
        }

        if (
          ![
            "github-token",
            "github-username",
            "max-repos",
            "sort-by",
            "sort-order",
          ].includes(key)
        )
          return;

        if (this._settingsDebounceId) {
          GLib.source_remove(this._settingsDebounceId);
          this._settingsDebounceId = null;
        }
        this._settingsDebounceId = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          1500,
          () => {
            this._settingsDebounceId = null;
            this._loadRepositories();
            return GLib.SOURCE_REMOVE;
          },
        );
      },
    );
  }

  _updatePanelPosition() {
    if (!this._indicator) return;

    // Remove from current position
    const container = this._indicator.get_parent();
    if (container) {
      container.remove_child(this._indicator);
    }

    // Add to new position
    const panelBox = this._settings.get_string("panel-box") || "right";
    Main.panel.addToStatusArea("github-tray", this._indicator, 0, panelBox);
  }

  // Network
  _waitForNetworkAndLoad() {
    const networkMonitor = Gio.NetworkMonitor.get_default();

    if (networkMonitor.get_connectivity() === Gio.NetworkConnectivity.FULL) {
      this._loadRepositories();
    } else {
      this._ui.showMessage(_("Waiting for network connection..."));

      this._networkChangedId = networkMonitor.connect(
        "network-changed",
        (monitor) => {
          if (
            monitor.get_connectivity() === Gio.NetworkConnectivity.FULL &&
            this._indicator
          ) {
            this._loadRepositories();
            if (this._networkChangedId) {
              monitor.disconnect(this._networkChangedId);
              this._networkChangedId = null;
            }
          }
        },
      );
    }
  }

  // Cleanup
  _cleanupTimers() {
    if (this._refreshTimeout) {
      GLib.source_remove(this._refreshTimeout);
      this._refreshTimeout = null;
    }
    if (this._notificationRefreshTimeout) {
      GLib.source_remove(this._notificationRefreshTimeout);
      this._notificationRefreshTimeout = null;
    }
    if (this._monitoredWorkflowRefreshTimeout) {
      GLib.source_remove(this._monitoredWorkflowRefreshTimeout);
      this._monitoredWorkflowRefreshTimeout = null;
    }
    if (this._settingsDebounceId) {
      GLib.source_remove(this._settingsDebounceId);
      this._settingsDebounceId = null;
    }
    if (this._detectChangesTimeoutId) {
      GLib.source_remove(this._detectChangesTimeoutId);
      this._detectChangesTimeoutId = null;
    }
    if (this._menuReopenTimeout) {
      GLib.source_remove(this._menuReopenTimeout);
      this._menuReopenTimeout = null;
    }
    if (this._menuCloseTimeout) {
      GLib.source_remove(this._menuCloseTimeout);
      this._menuCloseTimeout = null;
    }
  }

  _disconnectSignals() {
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    if (this._menuOpenChangedId) {
      this._indicator.menu.disconnect(this._menuOpenChangedId);
      this._menuOpenChangedId = null;
    }
    if (this._networkChangedId) {
      const networkMonitor = Gio.NetworkMonitor.get_default();
      networkMonitor.disconnect(this._networkChangedId);
      this._networkChangedId = null;
    }
  }

  _destroyIndicator() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }

  _cleanupState() {
    this._httpSession.abort();
    this._httpSession = null;
    this._settings = null;
    this._lastRepos = null;
    this._lastFollowers = null;
    this._pendingUpdate = null;
    this._pendingDetectChanges = null;
    this._ui = null;
    this._debugBtn = null;
  }
}
