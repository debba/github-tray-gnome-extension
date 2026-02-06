import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GitHubTrayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // --- Main page ---
        const page = new Adw.PreferencesPage({
            title: _('GitHub Tray'),
            icon_name: 'folder-remote-symbolic',
        });

        // --- Authentication group ---
        const authGroup = new Adw.PreferencesGroup({
            title: _('GitHub Authentication'),
            description: _('Create a token at github.com/settings/tokens\nRequired scopes: repo (private) or public_repo (public only)'),
        });

        // Username (apply button instead of saving per-keystroke)
        const usernameRow = new Adw.EntryRow({
            title: _('GitHub Username'),
            text: settings.get_string('github-username'),
            show_apply_button: true,
        });
        usernameRow.connect('apply', () => {
            settings.set_string('github-username', usernameRow.get_text());
        });
        authGroup.add(usernameRow);

        // Token (password field with apply)
        const tokenRow = new Adw.PasswordEntryRow({
            title: _('Personal Access Token'),
            text: settings.get_string('github-token'),
            show_apply_button: true,
        });
        tokenRow.connect('apply', () => {
            settings.set_string('github-token', tokenRow.get_text());
        });
        authGroup.add(tokenRow);

        page.add(authGroup);

        // --- Display group ---
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
            description: _('Configure how repositories are shown'),
        });

        // Panel position
        const panelRow = new Adw.ComboRow({
            title: _('Panel position'),
            subtitle: _('Where the icon appears in the top bar'),
            model: Gtk.StringList.new([_('Left'), _('Center'), _('Right')]),
        });

        const panelBoxMap = ['left', 'center', 'right'];
        const currentPanelBox = settings.get_string('panel-box');
        const idx = panelBoxMap.indexOf(currentPanelBox);
        panelRow.selected = idx !== -1 ? idx : 2;

        panelRow.connect('notify::selected', () => {
            settings.set_string('panel-box', panelBoxMap[panelRow.selected]);
        });
        displayGroup.add(panelRow);

        // Max repos
        const maxReposRow = new Adw.SpinRow({
            title: _('Max repositories'),
            subtitle: _('Maximum number of repositories to display'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 50,
                step_increment: 1,
                value: settings.get_int('max-repos'),
            }),
        });
        maxReposRow.connect('notify::value', () => {
            settings.set_int('max-repos', maxReposRow.value);
        });
        displayGroup.add(maxReposRow);

        page.add(displayGroup);

        window.add(page);
    }
}
