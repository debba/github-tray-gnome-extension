import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const GITHUB_API_URL = 'https://api.github.com';

// Language color map for popular languages
const LANG_COLORS = {
    'JavaScript':  '#f1e05a',
    'TypeScript':  '#3178c6',
    'Python':      '#3572A5',
    'Java':        '#b07219',
    'C':           '#555555',
    'C++':         '#f34b7d',
    'C#':          '#178600',
    'Go':          '#00ADD8',
    'Rust':        '#dea584',
    'Ruby':        '#701516',
    'PHP':         '#4F5D95',
    'Swift':       '#F05138',
    'Kotlin':      '#A97BFF',
    'Dart':        '#00B4AB',
    'Shell':       '#89e051',
    'HTML':        '#e34c26',
    'CSS':         '#563d7c',
    'Lua':         '#000080',
    'Vim Script':  '#199f4b',
    'Scala':       '#c22d40',
    'Haskell':     '#5e5086',
    'R':           '#198CE7',
    'Elixir':      '#6e4a7e',
    'Clojure':     '#db5855',
    'Perl':        '#0298c3',
    'Objective-C': '#438eff',
    'Vue':         '#41b883',
    'SCSS':        '#c6538c',
    'Svelte':      '#ff3e00',
    'Zig':         '#ec915c',
    'Nix':         '#7e7eff',
    'GDScript':    '#355570',
    'Vala':        '#a56de2',
};

export default class GitHubTrayExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._httpSession = new Soup.Session();
        this._lastRepos = null;
        this._isLoading = false;

        this._indicator = new PanelMenu.Button(0.0, 'GitHub Tray');

        // GitHub icon with fallback
        this._icon = new St.Icon({
            icon_name: 'github-symbolic',
            style_class: 'system-status-icon',
        });
        this._icon.set_fallback_icon_name('folder-remote-symbolic');

        // Unread badge (hidden by default)
        this._badge = new St.Label({
            style_class: 'github-tray-badge',
            style: 'font-size: 7px; font-weight: bold; color: #fff; '
                 + 'background-color: #e33; border-radius: 6px; '
                 + 'min-width: 12px; text-align: center; '
                 + 'padding: 0 2px; margin-left: -6px; margin-top: -4px;',
            text: '',
            visible: false,
        });

        const iconBox = new St.BoxLayout({style: 'spacing: 0px;'});
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
        const bottomBox = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const bottomLayout = new St.BoxLayout({x_expand: true, style: 'spacing: 12px;'});

        const refreshBtn = new St.Button({
            label: _('Refresh'),
            style_class: 'button',
            style: 'min-width: 80px;',
            can_focus: true,
        });
        refreshBtn.connect('clicked', () => {
            this._loadRepositories();
            this._indicator.menu.close();
        });
        bottomLayout.add_child(refreshBtn);

        const settingsBtn = new St.Button({
            label: _('Settings'),
            style_class: 'button',
            style: 'min-width: 80px;',
            can_focus: true,
        });
        settingsBtn.connect('clicked', () => {
            this.openPreferences();
            this._indicator.menu.close();
        });
        bottomLayout.add_child(settingsBtn);

        bottomBox.add_child(bottomLayout);
        this._indicator.menu.addMenuItem(bottomBox);

        // Add to panel
        const panelBox = this._settings.get_string('panel-box') || 'right';
        Main.panel.addToStatusArea('github-tray', this._indicator, 0, panelBox);

        // Initial load
        this._loadRepositories();

        // Auto-refresh every 5 minutes
        this._refreshTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
            this._loadRepositories();
            return GLib.SOURCE_CONTINUE;
        });

        // Listen to settings changes (debounced)
        this._settingsDebounceId = null;
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            // Only reload for relevant keys
            if (!['github-token', 'github-username', 'max-repos'].includes(key))
                return;

            if (this._settingsDebounceId) {
                GLib.source_remove(this._settingsDebounceId);
                this._settingsDebounceId = null;
            }
            this._settingsDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                this._settingsDebounceId = null;
                this._loadRepositories();
                return GLib.SOURCE_REMOVE;
            });
        });
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
        if (this._isLoading)
            return;

        const token = this._settings.get_string('github-token');
        const username = this._settings.get_string('github-username');

        if (!token || !username) {
            this._showMessage(_('Configure token and username in Settings'));
            return;
        }

        this._isLoading = true;
        this._showMessage(_('Loading repositories...'));

        try {
            const repos = await this._fetchRepositories(token, username);
            this._detectNewStars(repos);
            this._lastRepos = repos;
            this._updateMenu(repos, username);
        } catch (error) {
            logError(error, 'GitHubTray');
            this._showMessage(_('Error loading repositories'));
            Main.notifyError(
                _('GitHub Tray'),
                _('Failed to fetch repositories: %s').format(error.message)
            );
        } finally {
            this._isLoading = false;
        }
    }

    async _fetchRepositories(token, username) {
        const maxRepos = this._settings.get_int('max-repos');
        const message = Soup.Message.new(
            'GET',
            `${GITHUB_API_URL}/users/${username}/repos?sort=updated&per_page=${maxRepos}`
        );

        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/vnd.github.v3+json');
        message.request_headers.append('User-Agent', 'GNOME-Shell-GitHub-Tray');

        const bytes = await this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null
        );

        const statusCode = message.get_status();
        if (statusCode !== Soup.Status.OK) {
            throw new Error(`HTTP ${statusCode}`);
        }

        const data = new TextDecoder().decode(bytes.get_data());
        return JSON.parse(data);
    }

    /**
     * Detect if any repo gained stars since last check and show a notification.
     */
    _detectNewStars(newRepos) {
        if (!this._lastRepos)
            return;

        const oldMap = new Map(this._lastRepos.map(r => [r.id, r.stargazers_count]));
        let totalNew = 0;
        const gained = [];

        for (const repo of newRepos) {
            const oldStars = oldMap.get(repo.id);
            if (oldStars !== undefined && repo.stargazers_count > oldStars) {
                const diff = repo.stargazers_count - oldStars;
                totalNew += diff;
                gained.push(`${repo.name} +${diff}`);
            }
        }

        if (totalNew > 0) {
            this._badge.text = totalNew.toString();
            this._badge.visible = true;
            Main.notify(
                _('GitHub Tray'),
                _('New stars: %s').format(gained.join(', '))
            );
            // Hide badge when menu is opened
            this._indicator.menu.connect('open-state-changed', (_menu, open) => {
                if (open) {
                    this._badge.visible = false;
                    this._badge.text = '';
                }
            });
        }
    }

    _updateMenu(repos, username) {
        this._headerSection.removeAll();
        this._reposContainer.removeAll();

        // Header row
        const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
        const headerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const headerBox = new St.BoxLayout({
            x_expand: true,
            style: 'spacing: 8px; padding: 4px 0;',
        });
        const headerLabel = new St.Label({
            text: `@${username}`,
            style: 'font-weight: bold; font-size: 13px;',
        });
        headerBox.add_child(headerLabel);

        // Spacer
        const spacer = new St.Widget({x_expand: true});
        headerBox.add_child(spacer);

        const totalStarsLabel = new St.Label({
            text: `${this._formatNumber(totalStars)} total`,
            style: 'font-size: 11px; color: #ffd700;',
        });
        headerBox.add_child(totalStarsLabel);

        headerItem.add_child(headerBox);
        this._headerSection.addMenuItem(headerItem);
        this._headerSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (repos.length === 0) {
            this._showMessage(_('No repositories found'));
            return;
        }

        for (const repo of repos) {
            const item = this._createRepoItem(repo);
            this._reposContainer.addMenuItem(item);
        }
    }

    _createRepoItem(repo) {
        const menuItem = new PopupMenu.PopupBaseMenuItem({
            style_class: 'github-repo-menu-item',
        });

        const outerBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 4px 0; spacing: 2px;',
        });

        // Top row: name + language
        const topRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'spacing: 8px;',
        });

        const nameLabel = new St.Label({
            text: repo.name,
            style: 'font-weight: bold;',
            x_expand: true,
        });
        nameLabel.clutter_text.set_ellipsize(3); // Pango.EllipsizeMode.END
        topRow.add_child(nameLabel);

        if (repo.language) {
            const langColor = LANG_COLORS[repo.language] || '#aaa';
            const langBox = new St.BoxLayout({vertical: false, style: 'spacing: 4px;'});
            const langDot = new St.Label({
                text: '\u25CF',
                style: `font-size: 9px; color: ${langColor};`,
            });
            const langLabel = new St.Label({
                text: repo.language,
                style: 'font-size: 10px; color: #aaa;',
            });
            langBox.add_child(langDot);
            langBox.add_child(langLabel);
            topRow.add_child(langBox);
        }

        outerBox.add_child(topRow);

        // Bottom row: stats
        const statsRow = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 16px;',
        });

        // Stars
        statsRow.add_child(this._statWidget('\u2605', this._formatNumber(repo.stargazers_count), '#ffd700'));

        // Issues
        statsRow.add_child(this._statWidget('\u25CB', this._formatNumber(repo.open_issues_count), '#ff6b6b'));

        // Forks
        statsRow.add_child(this._statWidget('\u2442', this._formatNumber(repo.forks_count), '#8be9fd'));

        // Last updated
        const updatedStr = this._relativeTime(repo.updated_at);
        const updatedLabel = new St.Label({
            text: updatedStr,
            style: 'font-size: 10px; color: #888;',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        statsRow.add_child(updatedLabel);

        outerBox.add_child(statsRow);

        // Description (if available)
        if (repo.description) {
            const descLabel = new St.Label({
                text: repo.description,
                style: 'font-size: 10px; color: #999; margin-top: 2px;',
                x_expand: true,
            });
            descLabel.clutter_text.set_ellipsize(3);
            descLabel.clutter_text.set_line_wrap(false);
            outerBox.add_child(descLabel);
        }

        menuItem.add_child(outerBox);

        // Open repo in browser (safe, no shell injection)
        menuItem.connect('activate', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(repo.html_url, null);
            } catch (e) {
                logError(e, 'GitHubTray:open-uri');
            }
        });

        return menuItem;
    }

    _statWidget(icon, text, color) {
        const box = new St.BoxLayout({vertical: false, style: 'spacing: 4px;'});
        const iconLabel = new St.Label({
            text: icon,
            style: `font-size: 11px; color: ${color};`,
        });
        const valueLabel = new St.Label({
            text: text,
            style: `font-size: 11px; color: ${color};`,
        });
        box.add_child(iconLabel);
        box.add_child(valueLabel);
        return box;
    }

    _formatNumber(num) {
        if (num >= 1000000)
            return `${(num / 1000000).toFixed(1)}M`;
        else if (num >= 1000)
            return `${(num / 1000).toFixed(1)}k`;
        return num.toString();
    }

    _relativeTime(isoString) {
        if (!isoString)
            return '';
        const now = GLib.DateTime.new_now_utc().to_unix();
        const then = GLib.DateTime.new_from_iso8601(isoString, null)?.to_unix() ?? 0;
        const diffSec = now - then;

        if (diffSec < 60)
            return _('just now');
        if (diffSec < 3600)
            return _('%d min ago').format(Math.floor(diffSec / 60));
        if (diffSec < 86400)
            return _('%d h ago').format(Math.floor(diffSec / 3600));
        if (diffSec < 2592000)
            return _('%d d ago').format(Math.floor(diffSec / 86400));
        return _('%d mo ago').format(Math.floor(diffSec / 2592000));
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
