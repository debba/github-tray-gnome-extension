import GLib from "gi://GLib";

export class RefreshManager {
  /**
   * @param {object} opts
   * @param {import('gi://Gio').Settings} opts.settings
   * @param {function(): void} opts.loadRepositories
   * @param {function(): void} opts.loadNotifications
   * @param {function(): void} opts.loadMonitoredWorkflowRuns
   */
  constructor({ settings, loadRepositories, loadNotifications, loadMonitoredWorkflowRuns }) {
    this._settings = settings;
    this._loadRepositories = loadRepositories;
    this._loadNotifications = loadNotifications;
    this._loadMonitoredWorkflowRuns = loadMonitoredWorkflowRuns;

    this._refreshTimeout = null;
    this._notificationRefreshTimeout = null;
    this._monitoredWorkflowRefreshTimeout = null;
  }

  // Starts periodic repository refresh (every 5 minutes)
  setupAutoRefresh() {
    if (this._refreshTimeout) {
      GLib.source_remove(this._refreshTimeout);
      this._refreshTimeout = null;
    }
    this._refreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      300,
      () => {
        this._loadRepositories();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  // Starts periodic notification refresh based on the configured interval
  setupNotificationRefresh() {
    if (!this._settings.get_boolean("show-notifications")) return;

    if (this._notificationRefreshTimeout) {
      GLib.source_remove(this._notificationRefreshTimeout);
      this._notificationRefreshTimeout = null;
    }

    this._loadNotifications();
    const interval = this._settings.get_int("notification-interval");
    this._notificationRefreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      interval,
      () => {
        if (this._settings.get_boolean("show-notifications")) {
          this._loadNotifications();
        }
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  // Starts periodic monitored workflow refresh (every 5 minutes)
  setupMonitoredWorkflowRefresh() {
    if (this._monitoredWorkflowRefreshTimeout) {
      GLib.source_remove(this._monitoredWorkflowRefreshTimeout);
      this._monitoredWorkflowRefreshTimeout = null;
    }

    const interval = 300;
    this._monitoredWorkflowRefreshTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      interval,
      () => {
        this._loadMonitoredWorkflowRuns();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  // Restarts the notification refresh timer (e.g. when show-notifications setting changes)
  restartNotificationRefresh() {
    if (this._notificationRefreshTimeout) {
      GLib.source_remove(this._notificationRefreshTimeout);
      this._notificationRefreshTimeout = null;
    }
    this.setupNotificationRefresh();
  }

  // Removes all active refresh timers
  cleanup() {
    if (this._refreshTimeout) {
      GLib.source_remove(this._refreshTimeout);
      this._refreshTimeout = null;
    }
    if (this._notificationRefreshTimeout) {
      GLib.source_remove(this._notificationRefreshTimeout);
      this._notificationRefreshTimeout = null;
    }
    if (this._monitoredWorkflowRefreshTimeout) {
      GLib.source_remove(this._monitoredWorkflowRefreshTimeout);
      this._monitoredWorkflowRefreshTimeout = null;
    }
  }

  destroy() {
    this.cleanup();
    this._settings = null;
  }
}
