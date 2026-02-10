import St from "gi://St";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { formatNumber, relativeTime } from "./utils.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

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

export class GitHubTrayUI {
  constructor(indicator, settings) {
    this._indicator = indicator;
    this._settings = settings;
    this._reposContainer = null;
    this._headerSection = null;
  }

  buildMenu(onRefresh, onOpenPrefs, onDebug) {
    // Header with user info
    this._headerSection = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._headerSection);

    // Repos container wrapped in ScrollView
    this._reposContainer = new PopupMenu.PopupMenuSection();

    const reposScrollView = new St.ScrollView({
      style_class: "github-tray-scrollview",
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      enable_mouse_scrolling: true,
    });
    reposScrollView.set_child(this._reposContainer.actor);

    const scrollSection = new PopupMenu.PopupMenuSection();
    scrollSection.actor.add_child(reposScrollView);
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

    const refreshBtn = new St.Button({
      label: _("Refresh"),
      style_class: "button github-tray-btn-primary",
      can_focus: true,
    });
    refreshBtn.connect("clicked", onRefresh);
    bottomLayout.add_child(refreshBtn);

    const settingsBtn = new St.Button({
      label: _("Settings"),
      style_class: "button github-tray-btn-secondary",
      can_focus: true,
    });
    settingsBtn.connect("clicked", onOpenPrefs);
    bottomLayout.add_child(settingsBtn);

    const debugBtn = new St.Button({
      label: _("Debug"),
      style_class: "button github-tray-btn-secondary",
      can_focus: true,
      visible: this._settings.get_boolean("debug-mode"),
    });
    debugBtn.connect("clicked", onDebug);
    bottomLayout.add_child(debugBtn);
    this._debugBtn = debugBtn;

    bottomBox.add_child(bottomLayout);
    this._indicator.menu.addMenuItem(bottomBox);

    // Set menu width and max height with scroll
    this._indicator.menu.actor.add_style_class_name("github-tray-menu");
    this._indicator.menu.box.add_style_class_name("github-tray-menu-box");

    return { debugBtn };
  }

  updateDebugButtonVisibility() {
    if (this._debugBtn) {
      this._debugBtn.visible = this._settings.get_boolean("debug-mode");
    }
  }

  updateMenu(repos, username, userInfo = null) {
    try {
      if (!this._indicator) return;

      this._headerSection.removeAll();
      this._reposContainer.removeAll();

      const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
      const headerItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      const headerBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: "github-tray-header",
      });

      // First row: Avatar + username + followers
      const topRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "github-tray-header-top-row",
      });

      // Avatar + username button container
      const userBox = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-header-user-box",
      });

      // Avatar image
      if (userInfo?.avatar_url) {
        const avatarIcon = new St.Icon({
          gicon: Gio.Icon.new_for_string(userInfo.avatar_url),
          icon_size: 24,
          style_class: "github-tray-header-avatar",
        });
        userBox.add_child(avatarIcon);
      }

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
      userBox.add_child(usernameBtn);

      topRow.add_child(userBox);

      const spacer = new St.Widget({ x_expand: true });
      topRow.add_child(spacer);

      // Followers count badge
      if (userInfo?.followers !== undefined) {
        const followersBox = new St.BoxLayout({
          vertical: false,
          style_class: "github-tray-header-badge github-tray-header-followers",
        });
        const followersIcon = new St.Label({
          text: "👥",
          style_class: "github-tray-header-icon",
        });
        followersBox.add_child(followersIcon);
        const followersLabel = new St.Label({
          text: formatNumber(userInfo.followers),
          style_class: "github-tray-header-followers-text",
        });
        followersBox.add_child(followersLabel);
        topRow.add_child(followersBox);
      }

      headerBox.add_child(topRow);

      // Second row: Repos count + Stars
      const bottomRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "github-tray-header-bottom-row",
      });

      // Repos count badge
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
        text: formatNumber(userInfo?.public_repos || repos.length),
        style_class: "github-tray-header-repos-text",
      });
      reposCountBox.add_child(reposCountLabel);
      bottomRow.add_child(reposCountBox);

      // Stars badge
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
        text: formatNumber(totalStars),
        style_class: "github-tray-header-stars-text",
      });
      starsBox.add_child(totalStarsLabel);
      bottomRow.add_child(starsBox);

      headerBox.add_child(bottomRow);

      headerItem.add_child(headerBox);
      this._headerSection.addMenuItem(headerItem);
      this._headerSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      if (repos.length === 0) {
        this.showMessage(_("No repositories found"));
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

    const localPath = this._getLocalPath(repo.full_name);

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

    const topRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-top-row",
    });

    const repoDisplayName =
      repo.owner &&
      repo.owner.login !== this._settings.get_string("github-username")
        ? repo.full_name
        : repo.name;

    const nameBtn = new St.Button({
      label: repoDisplayName,
      style_class: "button github-tray-repo-name",
      can_focus: true,
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
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

    if (repo.fork && repo.parent) {
      const linksRow = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-links-row",
      });

      const forkBtn = new St.Button({
        label: _("🔀 parent"),
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

    const statsRow = new St.BoxLayout({
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-stats-row",
    });

    // Stars
    const starsBox = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
    });
    const starsIcon = new St.Label({
      text: "⭐",
      style_class: "github-tray-stat-icon",
    });
    const starsLabel = new St.Label({
      text: formatNumber(repo.stargazers_count),
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

    // Forks
    const forksBox = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
    });
    const forksIcon = new St.Label({
      text: "🍴",
      style_class: "github-tray-stat-icon",
    });
    const forksLabel = new St.Label({
      text: formatNumber(repo.forks_count),
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
        Gio.AppInfo.launch_default_for_uri(
          `${repo.html_url}/network/members`,
          null,
        );
      } catch (e) {
        logError(e, "GitHubTray:open-forks");
      }
      this._indicator.menu.close();
    });
    statsRow.add_child(forksBtn);

    // Issues
    const issuesBox = new St.BoxLayout({
      vertical: false,
      style_class: "github-tray-stat",
    });
    const issuesIcon = new St.Label({
      text: "🔴",
      style_class: "github-tray-stat-icon",
    });
    const issuesLabel = new St.Label({
      text: formatNumber(repo.open_issues_count),
      style_class: "github-tray-stat-value github-tray-issues-value",
    });
    issuesBox.add_child(issuesIcon);
    issuesBox.add_child(issuesLabel);

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

    // Last updated
    const updatedStr = relativeTime(repo.updated_at);
    const updatedLabel = new St.Label({
      text: _("Updated %s").format(updatedStr),
      style_class: "github-tray-updated",
      x_expand: true,
      x_align: Clutter.ActorAlign.END,
    });
    statsRow.add_child(updatedLabel);

    outerBox.add_child(statsRow);

    // Description
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

    // Folder button if local path exists
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

    mainBox.add_child(outerBox);
    menuItem.add_child(mainBox);

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
      const file = Gio.File.new_for_path(path);
      if (!file.query_exists(null)) {
        return;
      }

      Gio.Subprocess.new([editor, path], Gio.SubprocessFlags.NONE);
    } catch (e) {
      logError(e, "GitHubTray:open-local");
    }
  }

  showMessage(text) {
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
