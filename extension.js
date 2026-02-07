import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";

const GITHUB_API_URL = "https://api.github.com";

// Language color map for popular languages
const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Lua: "#000080",
  "Vim Script": "#199f4b",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  R: "#198CE7",
  Elixir: "#6e4a7e",
  Clojure: "#db5855",
  Perl: "#0298c3",
  "Objective-C": "#438eff",
  Vue: "#41b883",
  SCSS: "#c6538c",
  Svelte: "#ff3e00",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  GDScript: "#355570",
  Vala: "#a56de2",
};

export default class GitHubTrayExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._httpSession = new Soup.Session();
    this._lastRepos = null;
    this._isLoading = false;
    this._pendingUpdate = null; // Store pending menu update data
    this._detectChangesTimeoutId = null; // Track detect changes timeout

    this._indicator = new PanelMenu.Button(0.0, "GitHub Tray");

    // GitHub icon with custom SVG
    const iconPath = `${this.path}/icons/github-symbolic.svg`;
    const gicon = Gio.Icon.new_for_string(iconPath);
    this._icon = new St.Icon({
      gicon: gicon,
      style_class: "system-status-icon",
    });

    const iconBox = new St.BoxLayout({ style: "spacing: 0px; padding: 0 2px;" });
    iconBox.add_child(this._icon);
    this._indicator.add_child(iconBox);

    // Header with user info (populated after first fetch)
    this._headerSection = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._headerSection);

    // Repos container wrapped in ScrollView
    this._reposContainer = new PopupMenu.PopupMenuSection();

    // Create ScrollView
    this._reposScrollView = new St.ScrollView({
      style_class: "github-tray-scrollview",
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      enable_mouse_scrolling: true,
    });
    this._reposScrollView.set_child(this._reposContainer.actor);

    // Create wrapper section for menu insertion
    const scrollSection = new PopupMenu.PopupMenuSection();
    scrollSection.actor.add_child(this._reposScrollView);
    this._indicator.menu.addMenuItem(scrollSection);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Bottom bar: Refresh + Settings
    const bottomBox = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const bottomLayout = new St.BoxLayout({
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-bottom-box",
      style: "spacing: 8px;",
    });

    // GitHub-style refresh button
    const refreshBtn = new St.Button({
      label: _("Refresh"),
      style_class: "button github-tray-btn-primary",
      can_focus: true,
    });
    refreshBtn.connect("clicked", () => {
      this._indicator.menu.close();
      // Delay load to let menu close animation finish
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        if (this._indicator) {
          this._loadRepositories();
        }
        return GLib.SOURCE_REMOVE;
      });
    });
    bottomLayout.add_child(refreshBtn);

    // GitHub-style settings button
    const settingsBtn = new St.Button({
      label: _("Settings"),
      style_class: "button github-tray-btn-secondary",
      can_focus: true,
    });
    settingsBtn.connect("clicked", () => {
      this.openPreferences();
      this._indicator.menu.close();
    });
    bottomLayout.add_child(settingsBtn);

    // Debug button (only visible in debug mode)
    this._debugBtn = new St.Button({
      label: _("Debug"),
      style_class: "button github-tray-btn-secondary",
      can_focus: true,
      visible: this._settings.get_boolean("debug-mode"),
    });
    this._debugBtn.connect("clicked", () => {
      // Simulate a full data refresh with random changes to repos
      if (this._lastRepos && this._lastRepos.length >= 1) {
        const oldRepos = this._lastRepos;
        const username = this._settings.get_string("github-username");

        // Create modified repos with random changes (stars, issues, forks)
        const modifiedRepos = this._lastRepos.map((r, i) => {
          if (i < 3 && i < this._lastRepos.length) {
            const clone = { ...r };
            // Randomly add stars (50% chance)
            if (Math.random() > 0.5) {
              clone.stargazers_count += Math.floor(Math.random() * 5) + 1;
            }
            // Randomly add issues (30% chance)
            if (Math.random() > 0.7) {
              clone.open_issues_count += Math.floor(Math.random() * 3) + 1;
            }
            // Randomly add forks (20% chance)
            if (Math.random() > 0.8) {
              clone.forks_count += Math.floor(Math.random() * 2) + 1;
            }
            return clone;
          }
          return r;
        });

        // Update cached repos
        this._lastRepos = modifiedRepos;

        // Store pending update - will be applied when menu finishes closing
        // via the open-state-changed handler. This avoids destroying actors
        // during the menu close animation which corrupts the panel rendering.
        this._pendingUpdate = {
          repos: modifiedRepos,
          username,
          userInfo: null,
        };
        this._pendingDetectChanges = { newRepos: modifiedRepos, oldRepos };

        this._indicator.menu.close();
      } else {
        this._indicator.menu.close();
      }
    });
    bottomLayout.add_child(this._debugBtn);

    bottomBox.add_child(bottomLayout);
    this._indicator.menu.addMenuItem(bottomBox);

    // Add to panel
    const panelBox = this._settings.get_string("panel-box") || "right";
    Main.panel.addToStatusArea("github-tray", this._indicator, 0, panelBox);

    // Set menu width and max height with scroll
    this._indicator.menu.actor.add_style_class_name("github-tray-menu");
    this._indicator.menu.box.add_style_class_name("github-tray-menu-box");

    // Connect signal handler to hide badge when menu is opened and handle pending updates
    this._menuOpenChangedId = this._indicator.menu.connect(
      "open-state-changed",
      (_menu, open) => {
        if (!open) {
          // Menu closed - delay updates to let close animation finish,
          // otherwise modifying actors during animation corrupts the panel
          if (this._pendingUpdate || this._pendingDetectChanges) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
              if (!this._indicator) return GLib.SOURCE_REMOVE;

              // Apply pending menu update
              if (this._pendingUpdate) {
                const { repos, username, userInfo } = this._pendingUpdate;
                this._pendingUpdate = null;
                this._updateMenu(repos, username, userInfo);
              }

              // Trigger pending change detection
              if (this._pendingDetectChanges) {
                const { newRepos, oldRepos } = this._pendingDetectChanges;
                this._pendingDetectChanges = null;
                this._detectChanges(newRepos, oldRepos);
              }

              return GLib.SOURCE_REMOVE;
            });
          }
        }
      },
    );

    // Initial load - wait for network connection
    this._waitForNetworkAndLoad();

    // Auto-refresh every 5 minutes
    this._refreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      300,
      () => {
        this._loadRepositories();
        return GLib.SOURCE_CONTINUE;
      },
    );

    // Listen to settings changes (debounced)
    this._settingsDebounceId = null;
    this._settingsChangedId = this._settings.connect(
      "changed",
      (_settings, key) => {
        // Update debug button visibility when debug-mode changes
        if (key === "debug-mode" && this._debugBtn) {
          this._debugBtn.visible = this._settings.get_boolean("debug-mode");
          return;
        }

        // Only reload for relevant keys
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

  disable() {
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
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._httpSession = null;
    this._settings = null;
    this._lastRepos = null;
    this._pendingUpdate = null;
    this._pendingDetectChanges = null;
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

  _waitForNetworkAndLoad() {
    const networkMonitor = Gio.NetworkMonitor.get_default();

    // Use get_connectivity() to check actual internet connectivity
    if (networkMonitor.get_connectivity() === Gio.NetworkConnectivity.FULL) {
      // Network has full internet connectivity
      this._loadRepositories();
    } else {
      // No internet connectivity, show message and wait
      this._showMessage(_("Waiting for network connection..."));

      // Connect to network-changed signal
      this._networkChangedId = networkMonitor.connect("network-changed", (monitor) => {
        if (monitor.get_connectivity() === Gio.NetworkConnectivity.FULL && this._indicator) {
          // Internet is back, load repositories
          this._loadRepositories();
          // Disconnect after first successful connection
          if (this._networkChangedId) {
            monitor.disconnect(this._networkChangedId);
            this._networkChangedId = null;
          }
        }
      });
    }
  }

  async _loadRepositories() {
    if (this._isLoading || !this._indicator) return;

    const token = this._settings?.get_string("github-token");
    const username = this._settings?.get_string("github-username");

    if (!token || !username) {
      this._showMessage(_("Configure token and username in Settings"));
      return;
    }

    this._isLoading = true;

    // Don't show loading message if menu is open to avoid flickering
    if (!this._indicator.menu.isOpen) {
      this._showMessage(_("Loading repositories..."));
    }

    try {
      // Fetch user info (including avatar) in parallel with repositories
      const [repos, userInfo] = await Promise.all([
        this._fetchRepositories(token, username),
        this._fetchUserInfo(token, username),
      ]);

      // Guard: extension may have been disabled during async fetch
      if (!this._indicator) return;

      // Sort repositories (needed for 'stars' which API doesn't support)
      this._sortRepositories(repos);

      // Store old repos for comparison
      const oldRepos = this._lastRepos;
      this._lastRepos = repos;

      // Only update menu if it's not currently open to avoid rendering issues
      if (!this._indicator.menu.isOpen) {
        this._updateMenu(repos, username, userInfo);
      } else {
        // Menu is open - store update for later when menu closes
        this._pendingUpdate = { repos, username, userInfo };
      }

      // Delay notifications to avoid interference with menu update
      if (oldRepos) {
        this._detectChangesTimeoutId = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          100,
          () => {
            this._detectChangesTimeoutId = null;
            if (this._indicator) {
              this._detectChanges(repos, oldRepos);
            }
            return GLib.SOURCE_REMOVE;
          },
        );
      }
    } catch (error) {
      logError(error, "GitHubTray");
      if (this._indicator) {
        this._showMessage(_("Error loading repositories"));
        Main.notifyError(
          _("GitHub Tray"),
          _("Failed to fetch repositories: %s").format(error.message),
        );
      }
    } finally {
      this._isLoading = false;
    }
  }

  async _fetchUserInfo(token, username) {
    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/users/${username}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async _fetchRepositories(token, username) {
    const maxRepos = this._settings.get_int("max-repos");
    const sortBy = this._settings.get_string("sort-by");
    const sortOrder = this._settings.get_string("sort-order");

    // Map our sort options to GitHub API parameters
    let apiSort = "updated"; // default
    let apiDirection = sortOrder === "asc" ? "asc" : "desc";

    switch (sortBy) {
      case "stars":
        apiSort = "updated"; // GitHub API doesn't support sort by stars for user repos
        break;
      case "name":
        apiSort = "full_name";
        break;
      case "created":
        apiSort = "created";
        break;
      case "pushed":
        apiSort = "pushed";
        break;
      case "updated":
      default:
        apiSort = "updated";
        break;
    }

    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/user/repos?per_page=100&sort=${apiSort}&direction=${apiDirection}&affiliation=owner,collaborator,organization_member`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async _fetchOrgRepositories(token, username) {
    // This method is no longer needed since /user/repos with affiliation parameter
    // already includes organization repositories
    return [];
  }

  _sortRepositories(repos) {
    const sortBy = this._settings.get_string("sort-by");
    const sortOrder = this._settings.get_string("sort-order");
    const maxRepos = this._settings.get_int("max-repos");

    repos.sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case "stars":
          valueA = a.stargazers_count;
          valueB = b.stargazers_count;
          break;
        case "name":
          valueA = a.name.toLowerCase();
          valueB = b.name.toLowerCase();
          break;
        case "created":
          valueA = new Date(a.created_at).getTime();
          valueB = new Date(b.created_at).getTime();
          break;
        case "pushed":
          valueA = new Date(a.pushed_at).getTime();
          valueB = new Date(b.pushed_at).getTime();
          break;
        case "updated":
        default:
          valueA = new Date(a.updated_at).getTime();
          valueB = new Date(b.updated_at).getTime();
          break;
      }

      if (sortOrder === "asc") {
        return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
      } else {
        return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
      }
    });

    // Limit to max repos
    repos.splice(maxRepos);
  }

  /**
   * Detect if any repo gained stars, issues, or forks since last check and show notifications.
   */
  _detectChanges(newRepos, oldRepos) {
    if (!oldRepos) return;

    const oldMap = new Map(
      oldRepos.map((r) => [
        r.id,
        {
          stars: r.stargazers_count,
          issues: r.open_issues_count,
          forks: r.forks_count,
          name: r.name,
        },
      ]),
    );

    let totalNewStars = 0;
    const starsGained = [];
    const newIssues = [];
    const newForks = [];

    for (const repo of newRepos) {
      const oldData = oldMap.get(repo.id);
      if (!oldData) continue;

      // Check for new stars
      if (repo.stargazers_count > oldData.stars) {
        const diff = repo.stargazers_count - oldData.stars;
        totalNewStars += diff;
        starsGained.push({ name: repo.name, diff: diff });
      }

      // Check for new issues
      if (repo.open_issues_count > oldData.issues) {
        const diff = repo.open_issues_count - oldData.issues;
        newIssues.push({ name: repo.name, diff: diff });
      }

      // Check for new forks
      if (repo.forks_count > oldData.forks) {
        const diff = repo.forks_count - oldData.forks;
        newForks.push({ name: repo.name, diff: diff });
      }
    }

    // Show notifications for stars (only if menu is not open)
    if (totalNewStars > 0 && this._indicator && !this._indicator.menu.isOpen) {
      const starsMsg = starsGained
        .map((item) => `${item.name} +${item.diff} ⭐`)
        .join("\n");

      this._sendNotification(_("New Stars!"), starsMsg);
    }

    // Show notifications for new issues (only if menu is not open)
    if (
      newIssues.length > 0 &&
      this._indicator &&
      !this._indicator.menu.isOpen
    ) {
      const issuesMsg = newIssues
        .map(
          (item) =>
            `${item.name} +${item.diff} issue${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");

      this._sendNotification(_("New Issues Opened"), issuesMsg);
    }

    // Show notifications for new forks (only if menu is not open)
    if (
      newForks.length > 0 &&
      this._indicator &&
      !this._indicator.menu.isOpen
    ) {
      const forksMsg = newForks
        .map(
          (item) =>
            `${item.name} +${item.diff} fork${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");

      this._sendNotification(_("New Forks Created"), forksMsg);
    }
  }

  _updateMenu(repos, username, userInfo = null) {
    try {
      // Guard against destroyed indicator
      if (!this._indicator) return;

      // Clear menu sections
      this._headerSection.removeAll();
      this._reposContainer.removeAll();

      // Header row with GitHub style
      const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
      const headerItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      const headerBox = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "github-tray-header",
      });

      const usernameBtn = new St.Button({
        label: `@${username}`,
        style_class: "button github-tray-header-user",
        can_focus: true,
      });
      usernameBtn.connect("clicked", () => {
        try {
          Gio.AppInfo.launch_default_for_uri(
            `https://github.com/${username}`,
            null,
          );
        } catch (e) {
          logError(e, "GitHubTray:open-profile");
        }
        this._indicator.menu.close();
      });
      headerBox.add_child(usernameBtn);

      // Spacer
      const spacer = new St.Widget({ x_expand: true });
      headerBox.add_child(spacer);

      // Repos count badge (totali, non solo quelli visualizzati)
      const reposCountBox = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-header-badge github-tray-header-repos",
      });
      const reposIcon = new St.Label({
        text: "📦",
        style_class: "github-tray-header-icon",
      });
      reposCountBox.add_child(reposIcon);
      const reposCountLabel = new St.Label({
        text: this._formatNumber(userInfo?.public_repos || repos.length),
        style_class: "github-tray-header-repos-text",
      });
      reposCountBox.add_child(reposCountLabel);
      headerBox.add_child(reposCountBox);

      // Stars badge - GitHub style
      const starsBox = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-header-badge github-tray-header-stars",
      });

      const starIcon = new St.Label({
        text: "⭐",
        style_class: "github-tray-header-icon",
      });
      starsBox.add_child(starIcon);

      const totalStarsLabel = new St.Label({
        text: this._formatNumber(totalStars),
        style_class: "github-tray-header-stars-text",
      });
      starsBox.add_child(totalStarsLabel);
      headerBox.add_child(starsBox);

      headerItem.add_child(headerBox);
      this._headerSection.addMenuItem(headerItem);
      this._headerSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      if (repos.length === 0) {
        this._showMessage(_("No repositories found"));
        return;
      }

      for (const repo of repos) {
        const item = this._createRepoItem(repo);
        this._reposContainer.addMenuItem(item);
      }
    } catch (e) {
      logError(e, "GitHubTray:updateMenu");
    }
  }

  _createRepoItem(repo) {
    const menuItem = new PopupMenu.PopupBaseMenuItem({
      style_class: "github-tray-repo-item",
      can_focus: true,
    });

    // Check if local path exists
    const localPath = this._getLocalPath(repo.full_name);

    // Main horizontal container (repo info + action buttons)
    const mainBox = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const outerBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: localPath
        ? "github-tray-repo-box-local"
        : "github-tray-repo-box",
    });

    // Top row: name + language
    const topRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-top-row",
    });

    // Show full_name (owner/repo) or just repo name
    const repoDisplayName =
      repo.owner &&
      repo.owner.login !== this._settings.get_string("github-username")
        ? repo.full_name
        : repo.name;

    // Repo name as clickable button with hover effect
    const nameBtn = new St.Button({
      label: repoDisplayName,
      style_class: "button github-tray-repo-name",
      can_focus: true,
      x_expand: true,
    });
    // Set ellipsize for the button label
    const nameBtnChild = nameBtn.get_child();
    if (nameBtnChild && nameBtnChild.clutter_text) {
      nameBtnChild.clutter_text.set_ellipsize(3);
    }
    nameBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(repo.html_url, null);
      } catch (e) {
        logError(e, "GitHubTray:open-repo");
      }
      this._indicator.menu.close();
    });
    topRow.add_child(nameBtn);

    if (repo.language) {
      const langColor = LANG_COLORS[repo.language] || "#8b949e";
      const langBox = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-repo-lang-box",
        style: "spacing: 4px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      const langDot = new St.Label({
        text: "●",
        style: `font-size: 8px; color: ${langColor};`,
      });
      const langLabel = new St.Label({
        text: repo.language,
        style_class: "github-tray-repo-lang-text",
      });
      langBox.add_child(langDot);
      langBox.add_child(langLabel);
      topRow.add_child(langBox);
    }

    outerBox.add_child(topRow);

    // Quick links row (Fork, etc.) - GitHub style - only if needed
    if (repo.fork && repo.parent) {
      const linksRow = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-links-row",
      });

      const forkBtn = new St.Button({
        label: "🔀 parent",
        style_class: "button github-tray-link-btn-blue",
        can_focus: true,
      });
      forkBtn.connect("clicked", () => {
        try {
          Gio.AppInfo.launch_default_for_uri(repo.parent.html_url, null);
        } catch (e) {
          logError(e, "GitHubTray:open-fork");
        }
        this._indicator.menu.close();
      });
      linksRow.add_child(forkBtn);

      outerBox.add_child(linksRow);
    }

    // Bottom row: stats with GitHub styling
    const statsRow = new St.BoxLayout({
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-stats-row",
    });

    // Stars - GitHub style (con hover)
    const starsBox = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
    });
    const starsIcon = new St.Label({
      text: "⭐",
      style_class: "github-tray-stat-icon",
    });
    const starsLabel = new St.Label({
      text: this._formatNumber(repo.stargazers_count),
      style_class: "github-tray-stat-value",
    });
    starsBox.add_child(starsIcon);
    starsBox.add_child(starsLabel);

    const starsBtn = new St.Button({
      style_class: "button github-tray-stars-btn",
      can_focus: true,
    });
    starsBtn.set_child(starsBox);
    starsBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(`${repo.html_url}/stargazers`, null);
      } catch (e) {
        logError(e, "GitHubTray:open-stars");
      }
      this._indicator.menu.close();
    });
    statsRow.add_child(starsBtn);

    // Forks - GitHub style (con hover)
    const forksBox = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
    });
    const forksIcon = new St.Label({
      text: "🍴",
      style_class: "github-tray-stat-icon",
    });
    const forksLabel = new St.Label({
      text: this._formatNumber(repo.forks_count),
      style_class: "github-tray-stat-value",
    });
    forksBox.add_child(forksIcon);
    forksBox.add_child(forksLabel);

    const forksBtn = new St.Button({
      style_class: "button github-tray-forks-btn",
      can_focus: true,
    });
    forksBtn.set_child(forksBox);
    forksBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(`${repo.html_url}/network/members`, null);
      } catch (e) {
        logError(e, "GitHubTray:open-forks");
      }
      this._indicator.menu.close();
    });
    statsRow.add_child(forksBtn);

    // Issues - GitHub style (allineato con stars e forks)
    const issuesBox = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
    });
    const issuesIcon = new St.Label({
      text: "🔴",
      style_class: "github-tray-stat-icon",
    });
    const issuesLabel = new St.Label({
      text: this._formatNumber(repo.open_issues_count),
      style_class: "github-tray-stat-value github-tray-issues-value",
    });
    issuesBox.add_child(issuesIcon);
    issuesBox.add_child(issuesLabel);
    
    // Wrap issues in a button for clickability
    const issuesBtn = new St.Button({
      style_class: "button github-tray-issues-btn",
      can_focus: true,
    });
    issuesBtn.set_child(issuesBox);
    issuesBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(`${repo.html_url}/issues`, null);
      } catch (e) {
        logError(e, "GitHubTray:open-issues");
      }
      this._indicator.menu.close();
    });
    statsRow.add_child(issuesBtn);

    // Last updated - GitHub style
    const updatedStr = this._relativeTime(repo.updated_at);
    const updatedLabel = new St.Label({
      text: `Updated ${updatedStr}`,
      style_class: "github-tray-updated",
      x_expand: true,
      x_align: Clutter.ActorAlign.END,
    });
    statsRow.add_child(updatedLabel);

    outerBox.add_child(statsRow);

    // Description (if available) with GitHub styling
    if (repo.description) {
      const descLabel = new St.Label({
        text: repo.description,
        style_class: "github-tray-description",
        x_expand: true,
      });
      descLabel.clutter_text.set_ellipsize(3);
      descLabel.clutter_text.set_line_wrap(false);
      outerBox.add_child(descLabel);
    }

    // Add repo info to main box
    mainBox.add_child(outerBox);

    // Add prominent folder button if local path exists
    if (localPath) {
      const folderBtn = new St.Button({
        style_class: "button github-tray-folder-btn",
        can_focus: true,
      });
      const folderIcon = new St.Icon({
        icon_name: "folder-symbolic",
        icon_size: 20,
        style: "color: #3fb950;",
      });
      folderBtn.set_child(folderIcon);
      folderBtn.connect("clicked", () => {
        this._openLocalProject(localPath);
        this._indicator.menu.close();
      });
      mainBox.add_child(folderBtn);
    }

    menuItem.add_child(mainBox);

    // Left-click: always open GitHub link
    menuItem.connect("activate", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(repo.html_url, null);
      } catch (e) {
        logError(e, "GitHubTray:open-uri");
      }
      this._indicator.menu.close();
    });

    return menuItem;
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

  _openLocalProject(path) {
    const editor = this._settings.get_string("local-editor");

    try {
      // Check if path exists
      const file = Gio.File.new_for_path(path);
      if (!file.query_exists(null)) {
        Main.notifyError(
          _("GitHub Tray"),
          _("Local path does not exist: %s").format(path),
        );
        return;
      }

      // Launch editor
      const proc = Gio.Subprocess.new([editor, path], Gio.SubprocessFlags.NONE);

      // Don't wait for the editor to close
    } catch (e) {
      logError(e, "GitHubTray:open-local");
      Main.notifyError(
        _("GitHub Tray"),
        _("Failed to open with editor: %s").format(editor),
      );
    }
  }

  _statWidget(icon, text, color, shadow = "") {
    const box = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
      style: "spacing: 2px;",
    });
    const iconLabel = new St.Label({
      text: icon,
      style_class: "github-tray-stat-icon",
    });
    const valueLabel = new St.Label({
      text: text,
      style: `font-size: 10px; font-weight: 500; color: ${color};`,
    });
    box.add_child(iconLabel);
    box.add_child(valueLabel);
    return box;
  }

  _formatNumber(num) {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    else if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  }

  _relativeTime(isoString) {
    if (!isoString) return "";
    const now = GLib.DateTime.new_now_utc().to_unix();
    const then =
      GLib.DateTime.new_from_iso8601(isoString, null)?.to_unix() ?? 0;
    const diffSec = now - then;

    if (diffSec < 60) return _("just now");
    if (diffSec < 3600) return _("%d min ago").format(Math.floor(diffSec / 60));
    if (diffSec < 86400)
      return _("%d h ago").format(Math.floor(diffSec / 3600));
    if (diffSec < 2592000)
      return _("%d d ago").format(Math.floor(diffSec / 86400));
    return _("%d mo ago").format(Math.floor(diffSec / 2592000));
  }

  _showMessage(text) {
    if (!this._reposContainer) return;
    try {
      this._reposContainer.removeAll();
      const item = new PopupMenu.PopupMenuItem(text, {
        reactive: false,
        can_focus: false,
      });
      this._reposContainer.addMenuItem(item);
    } catch (e) {
      logError(e, "GitHubTray:showMessage");
    }
  }
}
