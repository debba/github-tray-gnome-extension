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
  constructor(indicator, settings, httpSession = null) {
    this._indicator = indicator;
    this._settings = settings;
    this._httpSession = httpSession;
    this._reposContainer = null;
    this._headerSection = null;
    this._notificationsSection = null;
    this._currentView = "repos";
    this._currentRepo = null;
    this._cachedRepos = null;
    this._cachedUsername = null;
    this._cachedUserInfo = null;
    this._cachedNotifications = [];
    this._onFetchIssues = null;
    this._onMarkNotificationRead = null;
  }

  buildMenu(onRefresh, onOpenPrefs, onDebug, onFetchIssues = null, onMarkNotificationRead = null) {
    this._onFetchIssues = onFetchIssues;
    this._onMarkNotificationRead = onMarkNotificationRead;

    // Apply font size class
    this._applyFontSize();

    // Header with user info
    this._headerSection = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._headerSection);

    // Notifications section (initially hidden)
    this._notificationsSection = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._notificationsSection);

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

  _applyFontSize() {
    const fontSize = this._settings.get_string("font-size");
    const menuActor = this._indicator.menu.actor;

    menuActor.remove_style_class_name("github-tray-font-small");
    menuActor.remove_style_class_name("github-tray-font-medium");
    menuActor.remove_style_class_name("github-tray-font-large");

    if (fontSize === "medium") {
      menuActor.add_style_class_name("github-tray-font-medium");
    } else if (fontSize === "large") {
      menuActor.add_style_class_name("github-tray-font-large");
    } else {
      menuActor.add_style_class_name("github-tray-font-small");
    }
  }

  updateBadge(unreadCount) {
    if (unreadCount > 0) {
      this._badge?.set_text(unreadCount > 99 ? "99+" : unreadCount.toString());
      this._badge?.show();
    } else {
      this._badge?.hide();
    }
  }

  setBadgeWidget(badge) {
    this._badge = badge;
  }

  updateMenu(repos, username, userInfo = null, notifications = []) {
    try {
      if (!this._indicator) return;

      this._cachedRepos = repos;
      this._cachedUsername = username;
      this._cachedUserInfo = userInfo;
      this._cachedNotifications = notifications;
      this._currentView = "repos";

      this._applyFontSize();
      this._headerSection.removeAll();
      this._reposContainer.removeAll();
      this._notificationsSection.removeAll();

      const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
      const unreadNotifications = notifications.filter((n) => n.unread);
      const unreadCount = unreadNotifications.length;

      const headerItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      const headerBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: "github-tray-header",
      });

      const topRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "github-tray-header-top-row",
      });

      const userBox = new St.BoxLayout({
        vertical: false,
        style_class: "github-tray-header-user-box",
      });

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
          console.error(e, "GitHubTray:open-profile");
        }
        this._indicator.menu.close();
      });
      userBox.add_child(usernameBtn);

      topRow.add_child(userBox);

      const spacer = new St.Widget({ x_expand: true });
      topRow.add_child(spacer);

      if (this._settings.get_boolean("show-notifications") && unreadCount > 0) {
        const notifBox = new St.BoxLayout({
          vertical: false,
          style_class: "github-tray-header-badge github-tray-header-notifications",
        });
        const notifIcon = new St.Label({
          text: "🔔",
          style_class: "github-tray-header-icon",
        });
        notifBox.add_child(notifIcon);
        const notifLabel = new St.Label({
          text: unreadCount.toString(),
          style_class: "github-tray-header-notifications-text",
        });
        notifBox.add_child(notifLabel);
        topRow.add_child(notifBox);
      }

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

      const bottomRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "github-tray-header-bottom-row",
      });

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

      if (this._settings.get_boolean("show-notifications") && unreadNotifications.length > 0) {
        this._buildNotificationsSection(unreadNotifications);
      }

      if (repos.length === 0) {
        this.showMessage(_("No repositories found"));
        return;
      }

      for (const repo of repos) {
        const item = this._createRepoItem(repo);
        this._reposContainer.addMenuItem(item);
      }
    } catch (e) {
      console.error(e, "GitHubTray:updateMenu");
    }
  }

  _buildNotificationsSection(notifications) {
    const maxDisplay = 5;
    const displayNotifications = notifications.slice(0, maxDisplay);

    const sectionTitle = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const titleBox = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      style_class: "github-tray-notification-header",
    });
    const titleLabel = new St.Label({
      text: _("Notifications"),
      style_class: "github-tray-notification-section-title",
      x_expand: true,
    });
    titleBox.add_child(titleLabel);

    const openAllBtn = new St.Button({
      label: _("Open All"),
      style_class: "button github-tray-link-btn-blue",
      can_focus: true,
    });
    openAllBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri("https://github.com/notifications", null);
      } catch (e) {
        console.error(e, "GitHubTray:open-notifications");
      }
      this._indicator.menu.close();
    });
    titleBox.add_child(openAllBtn);

    sectionTitle.add_child(titleBox);
    this._headerSection.addMenuItem(sectionTitle);

    for (const notification of displayNotifications) {
      const item = this._createNotificationItem(notification);
      this._headerSection.addMenuItem(item);
    }

    if (notifications.length > maxDisplay) {
      const moreItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      const moreLabel = new St.Label({
        text: _("+ %d more").format(notifications.length - maxDisplay),
        style_class: "github-tray-notification-more",
      });
      moreItem.add_child(moreLabel);
      this._headerSection.addMenuItem(moreItem);
    }
  }

  _createNotificationItem(notification) {
    const menuItem = new PopupMenu.PopupBaseMenuItem({
      style_class: "github-tray-notification-item",
      can_focus: true,
    });

    const mainBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "github-tray-notification-box",
    });

    const topRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-notification-top-row",
    });

    const iconMap = {
      Issue: "🔴",
      IssueComment: "💬",
      PullRequest: "🟣",
      PullRequestReview: "👀",
      PullRequestReviewComment: "💬",
      Commit: "📝",
      Release: "🏷️",
      Discussion: "🗣️",
      Mention: "📛",
      Assign: "👤",
      ReviewRequested: "🔍",
      SecurityAlert: "⚠️",
    };

    const typeIcon = new St.Label({
      text: iconMap[notification.subject.type] || "📌",
      style_class: "github-tray-notification-type-icon",
    });
    topRow.add_child(typeIcon);

    const repoLabel = new St.Label({
      text: notification.repository.full_name,
      style_class: "github-tray-notification-repo",
    });
    topRow.add_child(repoLabel);

    const spacer = new St.Widget({ x_expand: true });
    topRow.add_child(spacer);

    mainBox.add_child(topRow);

    const titleRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const titleBtn = new St.Button({
      label: notification.subject.title,
      style_class: "button github-tray-notification-title-btn",
      can_focus: true,
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    const titleBtnChild = titleBtn.get_child();
    if (titleBtnChild && titleBtnChild.clutter_text) {
      titleBtnChild.clutter_text.set_ellipsize(3);
    }
    titleBtn.connect("clicked", () => {
      this._openNotification(notification);
    });
    titleRow.add_child(titleBtn);

    const markReadBtn = new St.Button({
      style_class: "button github-tray-mark-read-btn",
      can_focus: true,
    });
    const checkIcon = new St.Label({ text: "✓" });
    markReadBtn.set_child(checkIcon);
    markReadBtn.connect("clicked", () => {
      if (this._onMarkNotificationRead) {
        this._onMarkNotificationRead(notification, () => {
          menuItem.destroy();
        });
      }
    });
    titleRow.add_child(markReadBtn);

    mainBox.add_child(titleRow);
    menuItem.add_child(mainBox);

    menuItem.connect("activate", () => {
      this._openNotification(notification);
    });

    return menuItem;
  }

  _openNotification(notification) {
    const url = notification.subject.url?.replace("api.github.com/repos", "github.com") ||
      notification.repository.html_url;
    try {
      Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (e) {
      console.error(e, "GitHubTray:open-notification");
    }
    if (this._onMarkNotificationRead) {
      this._onMarkNotificationRead(notification, () => {});
    }
    this._indicator.menu.close();
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
        console.error(e, "GitHubTray:open-repo");
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
          console.error(e, "GitHubTray:open-fork");
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
        console.error(e, "GitHubTray:open-stars");
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
        console.error(e, "GitHubTray:open-forks");
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
      if (this._onFetchIssues && repo.open_issues_count > 0) {
        this._onFetchIssues(repo, (issues) => {
          this.showIssuesView(repo, issues);
        });
      } else {
        try {
          Gio.AppInfo.launch_default_for_uri(`${repo.html_url}/issues`, null);
        } catch (e) {
          console.error(e, "GitHubTray:open-issues");
        }
        this._indicator.menu.close();
      }
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
        console.error(e, "GitHubTray:open-uri");
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
      console.error(e, "GitHubTray:open-local");
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
      console.error(e, "GitHubTray:showMessage");
    }
  }

  showIssuesView(repo, issues) {
    if (!this._indicator) return;

    this._currentView = "issues";
    this._currentRepo = repo;

    this._headerSection.removeAll();
    this._reposContainer.removeAll();

    const headerItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const headerBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "github-tray-header",
    });

    const topRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const backBtn = new St.Button({
      label: _("← Back"),
      style_class: "button github-tray-back-btn",
      can_focus: true,
    });
    backBtn.connect("clicked", () => {
      this.showReposView();
    });
    topRow.add_child(backBtn);

    const spacer = new St.Widget({ x_expand: true });
    topRow.add_child(spacer);

    const openInBrowserBtn = new St.Button({
      label: _("Open in Browser"),
      style_class: "button github-tray-link-btn-blue",
      can_focus: true,
    });
    openInBrowserBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(`${repo.html_url}/issues`, null);
      } catch (e) {
        console.error(e, "GitHubTray:open-issues-browser");
      }
      this._indicator.menu.close();
    });
    topRow.add_child(openInBrowserBtn);

    headerBox.add_child(topRow);

    const titleRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      style_class: "github-tray-issues-title-row",
    });
    const titleLabel = new St.Label({
      text: `${repo.name} - ${_("Issues")}`,
      style_class: "github-tray-issues-title",
      x_expand: true,
    });
    titleRow.add_child(titleLabel);
    headerBox.add_child(titleRow);

    headerItem.add_child(headerBox);
    this._headerSection.addMenuItem(headerItem);
    this._headerSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    if (!issues || issues.length === 0) {
      this.showMessage(_("No open issues"));
      return;
    }

    for (const issue of issues) {
      const item = this._createIssueItem(issue, repo);
      this._reposContainer.addMenuItem(item);
    }
  }

  _createIssueItem(issue, repo) {
    const menuItem = new PopupMenu.PopupBaseMenuItem({
      style_class: "github-tray-issue-item",
      can_focus: true,
    });

    const mainBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "github-tray-issue-box",
    });

    const topRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "github-tray-issue-top-row",
    });

    const stateIcon = new St.Label({
      text: issue.state === "open" ? "🟢" : "🟣",
      style_class: "github-tray-issue-state-icon",
    });
    topRow.add_child(stateIcon);

    const issueNumber = new St.Label({
      text: `#${issue.number}`,
      style_class: "github-tray-issue-number",
    });
    topRow.add_child(issueNumber);

    const titleBtn = new St.Button({
      label: issue.title,
      style_class: "button github-tray-issue-title",
      can_focus: true,
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    const titleBtnChild = titleBtn.get_child();
    if (titleBtnChild && titleBtnChild.clutter_text) {
      titleBtnChild.clutter_text.set_ellipsize(3);
    }
    titleBtn.connect("clicked", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(issue.html_url, null);
      } catch (e) {
        console.error(e, "GitHubTray:open-issue");
      }
      this._indicator.menu.close();
    });
    topRow.add_child(titleBtn);

    mainBox.add_child(topRow);

    if (issue.labels && issue.labels.length > 0) {
      const labelsRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        style_class: "github-tray-issue-labels-row",
      });
      for (const label of issue.labels.slice(0, 4)) {
        const labelBox = new St.Label({
          text: label.name,
          style_class: "github-tray-issue-label",
          style: `background-color: #${label.color};`,
        });
        labelsRow.add_child(labelBox);
      }
      if (issue.labels.length > 4) {
        const moreLabel = new St.Label({
          text: `+${issue.labels.length - 4}`,
          style_class: "github-tray-issue-label-more",
        });
        labelsRow.add_child(moreLabel);
      }
      mainBox.add_child(labelsRow);
    }

    const metaRow = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      style_class: "github-tray-issue-meta-row",
    });

    if (issue.user) {
      const authorLabel = new St.Label({
        text: `@${issue.user.login}`,
        style_class: "github-tray-issue-author",
      });
      metaRow.add_child(authorLabel);
    }

    const spacer = new St.Widget({ x_expand: true });
    metaRow.add_child(spacer);

    const updatedStr = relativeTime(issue.updated_at);
    const updatedLabel = new St.Label({
      text: updatedStr,
      style_class: "github-tray-issue-updated",
    });
    metaRow.add_child(updatedLabel);

    mainBox.add_child(metaRow);

    menuItem.add_child(mainBox);

    menuItem.connect("activate", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(issue.html_url, null);
      } catch (e) {
        console.error(e, "GitHubTray:open-issue-activate");
      }
      this._indicator.menu.close();
    });

    return menuItem;
  }

  showReposView() {
    if (this._cachedRepos && this._cachedUsername) {
      this.updateMenu(this._cachedRepos, this._cachedUsername, this._cachedUserInfo, this._cachedNotifications);
    }
  }
}
