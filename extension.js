import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as BoxPointer from "resource:///org/gnome/shell/ui/boxpointer.js";
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

    this._indicator = new PanelMenu.Button(0.0, "GitHub Tray");

    // GitHub icon with custom SVG
    const iconPath = `${this.path}/icons/github-symbolic.svg`;
    const gicon = Gio.Icon.new_for_string(iconPath);
    this._icon = new St.Icon({
      gicon: gicon,
      style_class: "system-status-icon",
    });

    // Unread badge (hidden by default) - GitHub style
    this._badge = new St.Label({
      style_class: "github-tray-badge",
      style:
        "font-size: 7px; font-weight: bold; color: #ffffff; " +
        "background: #cf222e; " + // GitHub red for notifications
        "border-radius: 10px; " +
        "min-width: 14px; min-height: 14px; text-align: center; " +
        "padding: 2px 4px; margin-left: -8px; margin-top: -6px; " +
        "border: 2px solid #0d1117;", // GitHub dark background
      text: "",
      visible: false,
    });

    const iconBox = new St.BoxLayout({ style: "spacing: 0px;" });
    iconBox.add_child(this._icon);
    iconBox.add_child(this._badge);
    this._indicator.add_child(iconBox);

    // Header with user info (populated after first fetch)
    this._headerSection = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._headerSection);

    // Repos container
    this._reposContainer = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._reposContainer);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Bottom bar: Refresh + Settings
    const bottomBox = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const bottomLayout = new St.BoxLayout({
      x_expand: true,
      style: "spacing: 8px; padding: 6px 10px;",
    });

    // GitHub-style refresh button
    const refreshBtn = new St.Button({
      label: _("Refresh"),
      style_class: "button",
      style:
        "min-width: 90px; padding: 6px 16px; " +
        "background: #238636; " + // GitHub green
        "border-radius: 6px; font-weight: 600; font-size: 11px; " +
        "color: #ffffff; " +
        "border: 1px solid rgba(31, 111, 235, 0.4); " +
        "transition-duration: 150ms;",
      can_focus: true,
    });
    refreshBtn.connect("clicked", () => {
      this._loadRepositories();
      this._indicator.menu.close();
    });
    refreshBtn.connect("enter-event", () => {
      refreshBtn.set_style(
        "min-width: 90px; padding: 6px 16px; " +
          "background: #2ea043; " + // GitHub green hover
          "border-radius: 6px; font-weight: 600; font-size: 11px; " +
          "color: #ffffff; " +
          "border: 1px solid rgba(31, 111, 235, 0.5); " +
          "transition-duration: 150ms;",
      );
    });
    refreshBtn.connect("leave-event", () => {
      refreshBtn.set_style(
        "min-width: 90px; padding: 6px 16px; " +
          "background: #238636; " +
          "border-radius: 6px; font-weight: 600; font-size: 11px; " +
          "color: #ffffff; " +
          "border: 1px solid rgba(31, 111, 235, 0.4); " +
          "transition-duration: 150ms;",
      );
    });
    bottomLayout.add_child(refreshBtn);

    // GitHub-style settings button
    const settingsBtn = new St.Button({
      label: _("Settings"),
      style_class: "button",
      style:
        "min-width: 90px; padding: 6px 16px; " +
        "background: #21262d; " + // GitHub button background
        "border-radius: 6px; font-weight: 600; font-size: 11px; " +
        "color: #c9d1d9; " + // GitHub text color
        "border: 1px solid rgba(240, 246, 252, 0.1); " +
        "transition-duration: 150ms;",
      can_focus: true,
    });
    settingsBtn.connect("clicked", () => {
      this.openPreferences();
      this._indicator.menu.close();
    });
    settingsBtn.connect("enter-event", () => {
      settingsBtn.set_style(
        "min-width: 90px; padding: 6px 16px; " +
          "background: #30363d; " + // GitHub hover
          "border-radius: 6px; font-weight: 600; font-size: 11px; " +
          "color: #c9d1d9; " +
          "border: 1px solid rgba(240, 246, 252, 0.2); " +
          "transition-duration: 150ms;",
      );
    });
    settingsBtn.connect("leave-event", () => {
      settingsBtn.set_style(
        "min-width: 90px; padding: 6px 16px; " +
          "background: #21262d; " +
          "border-radius: 6px; font-weight: 600; font-size: 11px; " +
          "color: #c9d1d9; " +
          "border: 1px solid rgba(240, 246, 252, 0.1); " +
          "transition-duration: 150ms;",
      );
    });
    bottomLayout.add_child(settingsBtn);

    bottomBox.add_child(bottomLayout);
    this._indicator.menu.addMenuItem(bottomBox);

    // Add to panel
    const panelBox = this._settings.get_string("panel-box") || "right";
    Main.panel.addToStatusArea("github-tray", this._indicator, 0, panelBox);

    // Set menu width and max height with scroll
    this._indicator.menu.actor.set_style("max-width: 170px;");
    this._indicator.menu.box.set_style(
      "max-height: 600px; overflow-y: auto;",
    );

    // Initial load
    this._loadRepositories();

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
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._httpSession = null;
    this._settings = null;
    this._lastRepos = null;
  }

  async _loadRepositories() {
    if (this._isLoading) return;

    const token = this._settings.get_string("github-token");
    const username = this._settings.get_string("github-username");

    if (!token || !username) {
      this._showMessage(_("Configure token and username in Settings"));
      return;
    }

    this._isLoading = true;
    this._showMessage(_("Loading repositories..."));

    try {
      // Fetch user info (including avatar) in parallel with repositories
      const [repos, userInfo] = await Promise.all([
        this._fetchRepositories(token, username),
        this._fetchUserInfo(token, username),
      ]);

      // Sort repositories (needed for 'stars' which API doesn't support)
      this._sortRepositories(repos);

      this._detectChanges(repos);
      this._lastRepos = repos;
      this._updateMenu(repos, username, userInfo);
    } catch (error) {
      logError(error, "GitHubTray");
      this._showMessage(_("Error loading repositories"));
      Main.notifyError(
        _("GitHub Tray"),
        _("Failed to fetch repositories: %s").format(error.message),
      );
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
  _detectChanges(newRepos) {
    if (!this._lastRepos) return;

    const oldMap = new Map(
      this._lastRepos.map((r) => [
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

    // Show notifications for stars
    if (totalNewStars > 0) {
      this._badge.text = totalNewStars.toString();
      this._badge.visible = true;

      const starsMsg = starsGained
        .map((item) => `${item.name} +${item.diff} ⭐`)
        .join("\n");

      Main.notify(_("⭐ New Stars!"), starsMsg);

      // Hide badge when menu is opened
      this._indicator.menu.connect("open-state-changed", (_menu, open) => {
        if (open) {
          this._badge.visible = false;
          this._badge.text = "";
        }
      });
    }

    // Show notifications for new issues
    if (newIssues.length > 0) {
      const issuesMsg = newIssues
        .map(
          (item) =>
            `${item.name} +${item.diff} issue${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");

      Main.notify(_("🔴 New Issues Opened"), issuesMsg);
    }

    // Show notifications for new forks
    if (newForks.length > 0) {
      const forksMsg = newForks
        .map(
          (item) =>
            `${item.name} +${item.diff} fork${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");

      Main.notify(_("🍴 New Forks Created"), forksMsg);
    }
  }

  _updateMenu(repos, username, userInfo = null) {
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
      style:
        "spacing: 12px; padding: 10px 16px; " +
        "background: linear-gradient(180deg, #161b22 0%, #0d1117 100%); " + // GitHub dark gradient
        "border-radius: 6px; margin: 4px 8px; " +
        "border: 1px solid #30363d;", // GitHub border
    });

    const usernameBtn = new St.Button({
      label: `@${username}`,
      style_class: "button",
      style:
        "font-weight: 600; font-size: 13px; color: #58a6ff; " + // GitHub blue
        "padding: 4px 8px; background: rgba(56, 139, 253, 0.1); " +
        "border: 1px solid rgba(56, 139, 253, 0.2); " +
        "border-radius: 6px;",
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

    // Stars badge - GitHub style
    const starsBox = new St.BoxLayout({
      vertical: false,
      style:
        "spacing: 6px; padding: 4px 10px; " +
        "background: rgba(255, 215, 0, 0.1); " +
        "border-radius: 6px; " +
        "border: 1px solid rgba(255, 215, 0, 0.2);",
    });

    const starIcon = new St.Label({
      text: "⭐",
      style: "font-size: 12px;",
    });
    starsBox.add_child(starIcon);

    const totalStarsLabel = new St.Label({
      text: this._formatNumber(totalStars),
      style: "font-size: 12px; font-weight: 600; color: #ffd700;",
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
  }

  _createRepoItem(repo) {
    const menuItem = new PopupMenu.PopupBaseMenuItem({
      style_class: "github-repo-menu-item",
      can_focus: true,
    });

    // Check if local path exists
    const localPath = this._getLocalPath(repo.full_name);

    // Main horizontal container (repo info + action buttons)
    const mainBox = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      style: "spacing: 6px;",
    });

    const outerBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style:
        "padding: 6px 10px; spacing: 4px; " +
        "border-radius: 6px; " +
        "background: #0d1117; " + // GitHub dark background
        "border: " +
        (localPath ? "2px solid #238636; " : "1px solid #21262d; ") + // Green border if local path exists
        "transition-duration: 100ms;",
    });

    // Add hover effect styling - GitHub style
    menuItem.connect("enter-event", () => {
      outerBox.set_style(
        "padding: 6px 10px; spacing: 4px; " +
          "border-radius: 6px; " +
          "background: #161b22; " + // GitHub hover background
          "border: " +
          (localPath ? "2px solid #2ea043; " : "1px solid #30363d; ") +
          "transition-duration: 100ms;",
      );
    });

    menuItem.connect("leave-event", () => {
      outerBox.set_style(
        "padding: 6px 10px; spacing: 4px; " +
          "border-radius: 6px; " +
          "background: #0d1117; " +
          "border: " +
          (localPath ? "2px solid #238636; " : "1px solid #21262d; ") +
          "transition-duration: 100ms;",
      );
    });

    // Top row: name + language
    const topRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      style: "spacing: 6px;",
    });

    // Show full_name (owner/repo) or just repo name
    const repoDisplayName =
      repo.owner &&
      repo.owner.login !== this._settings.get_string("github-username")
        ? repo.full_name
        : repo.name;

    const nameLabel = new St.Label({
      text: repoDisplayName,
      style: "font-weight: 600; font-size: 13px; color: #58a6ff;", // GitHub blue for repo names
      x_expand: true,
    });
    nameLabel.clutter_text.set_ellipsize(3); // Pango.EllipsizeMode.END
    topRow.add_child(nameLabel);

    if (repo.language) {
      const langColor = LANG_COLORS[repo.language] || "#8b949e";
      const langBox = new St.BoxLayout({
        vertical: false,
        style:
          "spacing: 5px; padding: 3px 8px; " +
          "background: rgba(110, 118, 129, 0.1); " + // GitHub tag background
          "border-radius: 12px; " + // GitHub rounded tag
          "border: 1px solid rgba(110, 118, 129, 0.2);",
      });
      const langDot = new St.Label({
        text: "●",
        style: `font-size: 10px; color: ${langColor};`,
      });
      const langLabel = new St.Label({
        text: repo.language,
        style: "font-size: 10px; font-weight: 500; color: #c9d1d9;", // GitHub text
      });
      langBox.add_child(langDot);
      langBox.add_child(langLabel);
      topRow.add_child(langBox);
    }

    outerBox.add_child(topRow);

    // Quick links row (Issues, Fork, etc.) - GitHub style
    const linksRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 6px; margin-top: 4px;",
    });

    // Issues link - GitHub style
    const issuesBtn = new St.Button({
      label: `🔴 ${repo.open_issues_count}`,
      style_class: "button",
      style:
        "padding: 3px 8px; font-size: 10px; font-weight: 500; " +
        "background: rgba(248, 81, 73, 0.1); " + // GitHub red
        "border-radius: 6px; " +
        "color: #f85149; " +
        "border: 1px solid rgba(248, 81, 73, 0.2);",
      can_focus: true,
    });
    issuesBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(`${repo.html_url}/issues`, null);
      } catch (e) {
        logError(e, "GitHubTray:open-issues");
      }
      this._indicator.menu.close();
    });
    linksRow.add_child(issuesBtn);

    // Fork link (only if repo is a fork) - GitHub style
    if (repo.fork && repo.parent) {
      const forkBtn = new St.Button({
        label: "🔀 parent",
        style_class: "button",
        style:
          "padding: 3px 8px; font-size: 10px; font-weight: 500; " +
          "background: rgba(88, 166, 255, 0.1); " + // GitHub blue
          "border-radius: 6px; " +
          "color: #58a6ff; " +
          "border: 1px solid rgba(88, 166, 255, 0.2);",
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
    }

    outerBox.add_child(linksRow);

    // Bottom row: stats with GitHub styling
    const statsRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 14px; margin-top: 4px;",
    });

    // Stars - GitHub style
    statsRow.add_child(
      this._statWidget(
        "⭐",
        this._formatNumber(repo.stargazers_count),
        "#8b949e",
      ),
    );

    // Forks - GitHub style
    statsRow.add_child(
      this._statWidget("🍴", this._formatNumber(repo.forks_count), "#8b949e"),
    );

    // Last updated - GitHub style
    const updatedStr = this._relativeTime(repo.updated_at);
    const updatedLabel = new St.Label({
      text: `Updated ${updatedStr}`,
      style: "font-size: 10px; color: #8b949e; font-weight: 400;", // GitHub muted text
      x_expand: true,
      x_align: Clutter.ActorAlign.END,
    });
    statsRow.add_child(updatedLabel);

    // Local folder indicator (small green icon in bottom right)
    if (localPath) {
      const folderIcon = new St.Icon({
        icon_name: "folder-symbolic",
        icon_size: 12,
        style: "color: #238636; margin-left: 6px;", // GitHub green
      });
      statsRow.add_child(folderIcon);
    }

    outerBox.add_child(statsRow);

    // Description (if available) with GitHub styling
    if (repo.description) {
      const descLabel = new St.Label({
        text: repo.description,
        style:
          "font-size: 11px; color: #8b949e; margin-top: 2px; " + // GitHub muted text
          "font-weight: 400; line-height: 1.4;",
        x_expand: true,
      });
      descLabel.clutter_text.set_ellipsize(3);
      descLabel.clutter_text.set_line_wrap(false);
      outerBox.add_child(descLabel);
    }

    // Add repo info to main box
    mainBox.add_child(outerBox);

    menuItem.add_child(mainBox);

    // Left-click: open local project or browser
    menuItem.connect("activate", () => {
      const localPath = this._getLocalPath(repo.full_name);
      if (localPath) {
        this._openLocalProject(localPath);
      } else {
        try {
          Gio.AppInfo.launch_default_for_uri(repo.html_url, null);
        } catch (e) {
          logError(e, "GitHubTray:open-uri");
        }
      }
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
      style: "spacing: 4px;", // GitHub minimal style, no background
    });
    const iconLabel = new St.Label({
      text: icon,
      style: `font-size: 11px;`, // Slightly larger
    });
    const valueLabel = new St.Label({
      text: text,
      style: `font-size: 11px; font-weight: 400; color: ${color};`, // GitHub weight
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
    this._reposContainer.removeAll();
    const item = new PopupMenu.PopupMenuItem(text, {
      reactive: false,
      can_focus: false,
    });
    this._reposContainer.addMenuItem(item);
  }
}
