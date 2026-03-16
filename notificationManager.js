import { GitHubApi } from "./githubApi.js";
import { gettext as _, ngettext } from "resource:///org/gnome/shell/extensions/extension.js";

/**
 * Converts a GitHub REST API subject URL to its corresponding web URL.
 * Supports both github.com and GitHub Enterprise Server.
 * e.g. https://api.github.com/repos/owner/repo/pulls/1 → https://github.com/owner/repo/pull/1
 * e.g. https://ghe.example.com/api/v3/repos/owner/repo/pulls/1 → https://ghe.example.com/owner/repo/pull/1
 *
 * @param {string|null|undefined} apiUrl
 * @param {string} enterpriseUrl - base URL of the GHE instance, or empty for github.com
 * @returns {string|null}
 */
function _subjectApiToWebUrl(apiUrl, enterpriseUrl = "") {
  if (!apiUrl) return null;

  let webUrl;
  if (enterpriseUrl) {
    const base = enterpriseUrl.replace(/\/$/, "");
    webUrl = apiUrl.replace(`${base}/api/v3/repos/`, `${base}/`);
  } else {
    webUrl = apiUrl.replace("https://api.github.com/repos/", "https://github.com/");
  }

  return webUrl.replace(/\/commits\/([a-f0-9]+)$/, "/commit/$1");
}

export class NotificationManager {
  /**
   * @param {object} opts
   * @param {import('gi://Soup').Session} opts.httpSession
   * @param {import('gi://Gio').Settings} opts.settings
   * @param {function(string, string, string|null): void} opts.sendNotification
   * @param {object} opts.ui  - GitHubTrayUI instance
   */
  constructor({ httpSession, settings, sendNotification, ui }) {
    this._httpSession = httpSession;
    this._settings = settings;
    this._sendNotification = sendNotification;
    this._ui = ui;

    this._lastNotifications = [];
    this._unreadCount = 0;
  }

  get lastNotifications() {
    return this._lastNotifications;
  }

  get unreadCount() {
    return this._unreadCount;
  }

  // Loads notifications from GitHub, optionally merging with existing ones
  async load(merge = false) {
    const token = this._settings?.get_string("github-token");
    if (!token) return;

    try {
      const api = new GitHubApi(this._httpSession, this._settings.get_string("github-enterprise-url"));
      let notifications = await api.fetchNotifications(token);

      notifications = this._filter(notifications);

      // Enrich notifications with state info (open/closed/merged) via GraphQL
      try {
        const stateMap = await api.fetchNotificationStates(token, notifications);
        for (const n of notifications) {
          n._stateInfo = stateMap.get(n.id) ?? null;
        }
      } catch (graphqlError) {
        console.error(graphqlError, "GitHubTray:fetchNotificationStates");
        // Non-fatal: continue without state enrichment
      }

      if (merge && this._lastNotifications.length > 0) {
        // Append only new notifications not already in the buffer
        const existingIds = new Set(this._lastNotifications.map((n) => n.id));
        const newOnes = notifications.filter((n) => !existingIds.has(n.id));
        // Preserve existing state info, merge new ones with their state
        this._lastNotifications = [...this._lastNotifications, ...newOnes];
      } else {
        const oldIds = new Set(this._lastNotifications.map((n) => n.id));
        const oldUnreadCount = this._unreadCount;
        this._lastNotifications = notifications;

        const unreadCount = notifications.filter((n) => n.unread).length;
        this._unreadCount = unreadCount;

        this._ui.updateBadge(unreadCount);

        if (
          unreadCount > oldUnreadCount &&
          this._settings.get_boolean("desktop-notifications")
        ) {
          const newCount = unreadCount - oldUnreadCount;
          if (newCount > 0) {
            // Determine the URL to open: specific page for a single new
            // notification, or the general notifications page for multiple
            const newUnread = notifications.filter(
              (n) => n.unread && !oldIds.has(n.id),
            );
            const enterpriseUrl = this._settings.get_string("github-enterprise-url");
            const baseWebUrl = enterpriseUrl ? enterpriseUrl.replace(/\/$/, "") : "https://github.com";
            let url = `${baseWebUrl}/notifications`;
            if (newUnread.length === 1) {
              url = _subjectApiToWebUrl(newUnread[0].subject?.url, enterpriseUrl) ?? url;
            }
            this._sendNotification(
              _("GitHub Notifications"),
              ngettext(
                "%d new notification",
                "%d new notifications",
                newCount,
              ).format(newCount),
              url,
            );
          }
        }
      }
    } catch (error) {
      console.error(error, "GitHubTray:loadNotifications");
    }
  }

  // Marks a single notification as read and refreshes the local buffer
  async markRead(notification, callback) {
    const token = this._settings?.get_string("github-token");
    if (!token) {
      callback();
      return;
    }

    try {
      const api = new GitHubApi(this._httpSession, this._settings.get_string("github-enterprise-url"));
      await api.markNotificationRead(token, notification.id);

      // Remove from local buffer
      this._lastNotifications = this._lastNotifications.filter(
        (n) => n.id !== notification.id,
      );
      this._unreadCount = Math.max(0, this._unreadCount - 1);
      this._ui.updateBadge(this._unreadCount);

      // Refresh UI immediately with updated buffer
      this._ui.refreshNotifications(this._lastNotifications);

      // If buffer is running low, fetch more and merge new ones
      if (this._lastNotifications.length < 5) {
        await this.load(true);
        this._ui.refreshNotifications(this._lastNotifications);
      }
    } catch (error) {
      console.error(error, "GitHubTray:markNotificationRead");
      callback();
    }
  }

  // Filters notifications based on user settings
  _filter(notifications) {
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

  destroy() {
    this._lastNotifications = [];
    this._unreadCount = 0;
    this._httpSession = null;
    this._settings = null;
    this._ui = null;
  }
}
