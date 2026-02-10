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
    this._isLoading = false;
    this._pendingUpdate = null;
    this._detectChangesTimeoutId = null;

    this._createIndicator();
    this._waitForNetworkAndLoad();
    this._setupAutoRefresh();
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
    const iconPath = `${this.path}/icons/github-symbolic.svg`;
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
    this._ui = new GitHubTrayUI(this._indicator, this._settings);
    const { debugBtn } = this._ui.buildMenu(
      () => this._loadRepositories(true),
      () => {
        this.openPreferences();
        this._indicator.menu.close();
      },
      () => this._onDebugClick(),
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

      if (oldRepos) {
        this._scheduleChangeDetection(repos, oldRepos, followers, oldFollowers);
      }
    } catch (error) {
      logError(error, "GitHubTray");
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

  _handleRepoUpdate(repos, username, userInfo, wasOpen, manualRefresh) {
    if (manualRefresh && wasOpen) {
      this._pendingUpdate = { repos, username, userInfo };
      this._indicator.menu.close();
      if (this._menuReopenTimeout) {
        GLib.source_remove(this._menuReopenTimeout);
        this._menuReopenTimeout = null;
      }
      this._menuReopenTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        this._menuReopenTimeout = null;
        if (this._indicator) {
          this._indicator.menu.open();
        }
        return GLib.SOURCE_REMOVE;
      });
    } else if (!this._indicator.menu.isOpen) {
      this._ui.updateMenu(repos, username, userInfo);
    } else {
      this._pendingUpdate = { repos, username, userInfo };
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

  _sendNotification(summary, body) {
    if (!summary || !body) return;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      try {
        Main.notify(summary, body);
      } catch (e) {
        logError(e, "GitHubTray:notify");
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
      const numNewFollowers = Math.random() > 0.5 ? 1 : Math.floor(Math.random() * 3) + 2;
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
      this._menuCloseTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        this._menuCloseTimeout = null;
        if (!this._indicator) return GLib.SOURCE_REMOVE;

        if (this._pendingUpdate) {
          const { repos, username, userInfo } = this._pendingUpdate;
          this._pendingUpdate = null;
          this._ui.updateMenu(repos, username, userInfo);
        }

        if (this._pendingDetectChanges) {
          const { newRepos, oldRepos, newFollowers, oldFollowers } = this._pendingDetectChanges;
          this._pendingDetectChanges = null;
          this._detectAndNotify(newRepos, oldRepos, newFollowers, oldFollowers);
        }

        return GLib.SOURCE_REMOVE;
      });
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

  _setupSettingsListener() {
    this._settingsDebounceId = null;
    this._settingsChangedId = this._settings.connect(
      "changed",
      (_settings, key) => {
        if (key === "debug-mode" && this._ui) {
          this._ui.updateDebugButtonVisibility();
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
