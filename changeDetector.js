import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { detectChanges, detectNewFollowers } from "./utils.js";

export class ChangeDetector {
  /**
   * @param {object} opts
   * @param {function(): boolean} opts.isMenuOpen
   */
  constructor({ isMenuOpen }) {
    this._isMenuOpen = isMenuOpen;
    this._detectChangesTimeoutId = null;
  }

  // Schedules change detection with a short debounce to avoid redundant calls
  schedule(newRepos, oldRepos, newFollowers, oldFollowers) {
    if (this._detectChangesTimeoutId) {
      GLib.source_remove(this._detectChangesTimeoutId);
      this._detectChangesTimeoutId = null;
    }
    this._detectChangesTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      100,
      () => {
        this._detectChangesTimeoutId = null;
        this._detectAndNotify(newRepos, oldRepos, newFollowers, oldFollowers);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  // Compares repo/follower data and sends desktop notifications for relevant changes
  _detectAndNotify(newRepos, oldRepos, newFollowers, oldFollowers) {
    const changes = detectChanges(newRepos, oldRepos);
    if (!changes || this._isMenuOpen()) return;

    if (changes.totalNewStars > 0) {
      const starsMsg = changes.starsGained
        .map((item) => `${item.name} +${item.diff} ⭐`)
        .join("\n");
      const starsUrl =
        changes.starsGained.length === 1
          ? `${changes.starsGained[0].html_url}/stargazers`
          : null;
      this._send(_("New Stars!"), starsMsg, starsUrl);
    }

    if (changes.newIssues.length > 0) {
      const issuesMsg = changes.newIssues
        .map(
          (item) =>
            `${item.name} +${item.diff} issue${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");
      const issuesUrl =
        changes.newIssues.length === 1
          ? `${changes.newIssues[0].html_url}/issues`
          : null;
      this._send(_("New Issues Opened"), issuesMsg, issuesUrl);
    }

    if (changes.newForks.length > 0) {
      const forksMsg = changes.newForks
        .map(
          (item) =>
            `${item.name} +${item.diff} fork${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");
      const forksUrl =
        changes.newForks.length === 1
          ? `${changes.newForks[0].html_url}/network/members`
          : null;
      this._send(_("New Forks Created"), forksMsg, forksUrl);
    }

    const newFollowersList = detectNewFollowers(newFollowers, oldFollowers);
    if (newFollowersList && newFollowersList.length > 0) {
      const followersMsg =
        newFollowersList.length === 1
          ? newFollowersList[0].login
          : `+${newFollowersList.length} followers`;
      const followersUrl =
        newFollowersList.length === 1
          ? (newFollowersList[0].html_url ?? null)
          : null;
      this._send(_("New Followers"), followersMsg, followersUrl);
    }
  }

  // Sends a desktop notification via GLib idle to avoid blocking the main loop
  _send(summary, body, url = null) {
    if (!summary || !body) return;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      try {
        _createNotification(summary, body, url);
      } catch (e) {
        console.error(e, "GitHubTray:notify");
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  // Cancels any pending debounced detection
  cleanup() {
    if (this._detectChangesTimeoutId) {
      GLib.source_remove(this._detectChangesTimeoutId);
      this._detectChangesTimeoutId = null;
    }
  }

  destroy() {
    this.cleanup();
  }
}

/**
 * Creates and shows a GNOME Shell notification using MessageTray.
 * The banner auto-dismisses after the standard timeout and the notification
 * persists in the notification center. If a URL is provided, an "Open" action
 * button is added to open it in the default browser.
 *
 * @param {string} summary
 * @param {string} body
 * @param {string|null} url
 */
function _createNotification(summary, body, url = null) {
  const source = new MessageTray.Source({
    title: "GitHub Tray",
    iconName: "github-symbolic",
  });
  Main.messageTray.add(source);

  const notification = new MessageTray.Notification({
    source,
    title: summary,
    body: body,
    isTransient: false,
    urgency: MessageTray.Urgency.NORMAL,
  });

  if (url) {
    notification.addAction(_("Open"), () => {
      try {
        Gio.AppInfo.launch_default_for_uri(url, null);
      } catch (e) {
        console.error(e, "GitHubTray:openUrl");
      }
    });
  }

  source.addNotification(notification);
}

/**
 * Standalone helper - sends a desktop notification via GLib idle.
 * Can be used outside of a ChangeDetector instance.
 *
 * @param {string} summary
 * @param {string} body
 * @param {string|null} url - Optional URL to open when clicking "Open"
 */
export function sendNotification(summary, body, url = null) {
  if (!summary || !body) return;

  GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    try {
      _createNotification(summary, body, url);
    } catch (e) {
      console.error(e, "GitHubTray:notify");
    }
    return GLib.SOURCE_REMOVE;
  });
}
