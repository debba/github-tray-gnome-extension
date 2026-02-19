import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
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
      this._send(_("New Stars!"), starsMsg);
    }

    if (changes.newIssues.length > 0) {
      const issuesMsg = changes.newIssues
        .map(
          (item) =>
            `${item.name} +${item.diff} issue${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");
      this._send(_("New Issues Opened"), issuesMsg);
    }

    if (changes.newForks.length > 0) {
      const forksMsg = changes.newForks
        .map(
          (item) =>
            `${item.name} +${item.diff} fork${item.diff > 1 ? "s" : ""}`,
        )
        .join("\n");
      this._send(_("New Forks Created"), forksMsg);
    }

    const newFollowersList = detectNewFollowers(newFollowers, oldFollowers);
    if (newFollowersList && newFollowersList.length > 0) {
      const followersMsg =
        newFollowersList.length === 1
          ? newFollowersList[0].login
          : `+${newFollowersList.length} followers`;
      this._send(_("New Followers"), followersMsg);
    }
  }

  // Sends a desktop notification via GLib idle to avoid blocking the main loop
  _send(summary, body) {
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
 * Standalone helper - sends a desktop notification via GLib idle.
 * Can be used outside of a ChangeDetector instance.
 *
 * @param {string} summary
 * @param {string} body
 */
export function sendNotification(summary, body) {
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
