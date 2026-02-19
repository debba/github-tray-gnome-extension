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
import { NotificationManager } from "./notificationManager.js";
import { WorkflowManager } from "./workflowManager.js";
import { RefreshManager } from "./refreshManager.js";
import { ChangeDetector, sendNotification } from "./changeDetector.js";

export default class GitHubTrayExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._httpSession = new Soup.Session();
    this._lastRepos = null;
    this._lastFollowers = null;
    this._isLoading = false;
    this._pendingUpdate = null;
    this._pendingDetectChanges = null;

    this._createIndicator();
    this._initManagers();
    this._waitForNetworkAndLoad();
    this._refreshManager.setupAutoRefresh();
    this._refreshManager.setupNotificationRefresh();
    this._refreshManager.setupMonitoredWorkflowRefresh();
    this._setupSettingsListener();
  }

  disable() {
    this._cleanupTimers();
    this._disconnectSignals();
    this._destroyIndicator();
    this._cleanupState();
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

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

    this._indicator.add_child(iconBox);

    // Build UI
    this._ui = new GitHubTrayUI(
      this._indicator,
      this._settings,
      this._httpSession,
    );
    this._ui.setBadgeWidget(null);
    this._ui.buildMenu(
      () => {
        this._loadRepositories(true);
        this._notificationManager.load();
      },
      () => {
        this.openPreferences();
        this._indicator.menu.close();
      },
      () => this._onDebugClick(),
      (repo, callback) => this._fetchRepoIssues(repo, callback),
      (notification, callback) =>
        this._notificationManager.markRead(notification, callback),
      (workflowRun, callback) =>
        this._workflowManager.rerun(workflowRun, callback),
      (repo, callback) => this._workflowManager.fetchForRepo(repo, callback),
      () => this._notificationManager.load(),
    );

    // Menu open-state handler
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

  _initManagers() {
    const isMenuOpen = () =>
      !!(this._indicator && this._indicator.menu.isOpen);

    this._notificationManager = new NotificationManager({
      httpSession: this._httpSession,
      settings: this._settings,
      sendNotification: (summary, body) => sendNotification(summary, body),
      ui: this._ui,
    });

    this._workflowManager = new WorkflowManager({
      httpSession: this._httpSession,
      settings: this._settings,
      sendNotification: (summary, body) => sendNotification(summary, body),
      getMonitoredRepos: () => this._getMonitoredRepos(),
      isMenuOpen,
    });

    this._changeDetector = new ChangeDetector({ isMenuOpen });

    this._refreshManager = new RefreshManager({
      settings: this._settings,
      loadRepositories: () => this._loadRepositories(),
      loadNotifications: () => this._notificationManager.load(),
      loadMonitoredWorkflowRuns: () => this._workflowManager.loadMonitored(),
    });
  }

  // -------------------------------------------------------------------------
  // Data Loading
  // -------------------------------------------------------------------------

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

      // Load workflow runs for monitored repos on first load
      if (!oldRepos) {
        this._workflowManager.loadMonitored();
      }

      if (oldRepos) {
        this._changeDetector.schedule(repos, oldRepos, followers, oldFollowers);
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

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Event Handlers
  // -------------------------------------------------------------------------

  _handleRepoUpdate(repos, username, userInfo, wasOpen, manualRefresh) {
    const notifications = this._notificationManager.lastNotifications;
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
              notifications || this._notificationManager.lastNotifications,
            );
          }

          if (this._pendingDetectChanges) {
            const { newRepos, oldRepos, newFollowers, oldFollowers } =
              this._pendingDetectChanges;
            this._pendingDetectChanges = null;
            this._changeDetector.schedule(
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

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  _setupSettingsListener() {
    this._settingsDebounceId = null;
    this._settingsChangedId = this._settings.connect(
      "changed",
      (_settings, key) => {
        if (key === "debug-mode" && this._ui) {
          this._ui.updateDebugButtonVisibility();
          return;
        }

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

    const container = this._indicator.get_parent();
    if (container) {
      container.remove_child(this._indicator);
    }

    const panelBox = this._settings.get_string("panel-box") || "right";
    Main.panel.addToStatusArea("github-tray", this._indicator, 0, panelBox);
  }

  // -------------------------------------------------------------------------
  // Network
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  _cleanupTimers() {
    this._refreshManager?.cleanup();
    this._changeDetector?.cleanup();

    if (this._settingsDebounceId) {
      GLib.source_remove(this._settingsDebounceId);
      this._settingsDebounceId = null;
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
    this._notificationManager?.destroy();
    this._workflowManager?.destroy();
    this._refreshManager?.destroy();
    this._changeDetector?.destroy();

    this._httpSession.abort();
    this._httpSession = null;
    this._settings = null;
    this._lastRepos = null;
    this._lastFollowers = null;
    this._pendingUpdate = null;
    this._pendingDetectChanges = null;
    this._ui = null;
  }
}
