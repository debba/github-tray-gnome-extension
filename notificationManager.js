import { GitHubApi } from "./githubApi.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export class NotificationManager {
  /**
   * @param {object} opts
   * @param {import('gi://Soup').Session} opts.httpSession
   * @param {import('gi://Gio').Settings} opts.settings
   * @param {function(string, string): void} opts.sendNotification
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
      const api = new GitHubApi(this._httpSession);
      let notifications = await api.fetchNotifications(token);

      notifications = this._filter(notifications);

      if (merge && this._lastNotifications.length > 0) {
        // Append only new notifications not already in the buffer
        const existingIds = new Set(this._lastNotifications.map((n) => n.id));
        const newOnes = notifications.filter((n) => !existingIds.has(n.id));
        this._lastNotifications = [...this._lastNotifications, ...newOnes];
      } else {
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
      const api = new GitHubApi(this._httpSession);
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
