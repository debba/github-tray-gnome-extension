import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class GitHubTrayPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    // --- Main page ---
    const page = new Adw.PreferencesPage({
      title: _("GitHub Tray"),
      icon_name: "folder-remote-symbolic",
    });

    // --- Authentication group ---
    const authGroup = new Adw.PreferencesGroup({
      title: _("Authentication"),
      description: _(
        "Create a token at github.com/settings/tokens\nRequired scopes: repo (private) or public_repo (public only)",
      ),
    });

    // Username (apply button instead of saving per-keystroke)
    const usernameRow = new Adw.EntryRow({
      title: _("GitHub Username"),
      text: settings.get_string("github-username"),
      show_apply_button: true,
    });
    usernameRow.connect("apply", () => {
      settings.set_string("github-username", usernameRow.get_text());
    });
    authGroup.add(usernameRow);

    // Token (password field with apply)
    const tokenRow = new Adw.PasswordEntryRow({
      title: _("Personal Access Token"),
      text: settings.get_string("github-token"),
      show_apply_button: true,
    });
    tokenRow.connect("apply", () => {
      settings.set_string("github-token", tokenRow.get_text());
    });
    authGroup.add(tokenRow);

    page.add(authGroup);

    // --- Sorting group ---
    const sortGroup = new Adw.PreferencesGroup({
      title: _("Sorting"),
      description: _("Configure how repositories are sorted"),
    });

    // Sort by
    const sortByRow = new Adw.ComboRow({
      title: _("Sort by"),
      subtitle: _("Criteria for sorting repositories"),
      model: Gtk.StringList.new([
        _("Last Updated"),
        _("Last Pushed"),
        _("Created Date"),
        _("Stars"),
        _("Name"),
      ]),
    });

    const sortByMap = ["updated", "pushed", "created", "stars", "name"];
    const currentSortBy = settings.get_string("sort-by");
    const sortByIdx = sortByMap.indexOf(currentSortBy);
    sortByRow.selected = sortByIdx !== -1 ? sortByIdx : 0;

    sortByRow.connect("notify::selected", () => {
      settings.set_string("sort-by", sortByMap[sortByRow.selected]);
    });
    sortGroup.add(sortByRow);

    // Sort order
    const sortOrderRow = new Adw.ComboRow({
      title: _("Sort order"),
      subtitle: _("Ascending or descending order"),
      model: Gtk.StringList.new([_("Descending"), _("Ascending")]),
    });

    const sortOrderMap = ["desc", "asc"];
    const currentSortOrder = settings.get_string("sort-order");
    const sortOrderIdx = sortOrderMap.indexOf(currentSortOrder);
    sortOrderRow.selected = sortOrderIdx !== -1 ? sortOrderIdx : 0;

    sortOrderRow.connect("notify::selected", () => {
      settings.set_string("sort-order", sortOrderMap[sortOrderRow.selected]);
    });
    sortGroup.add(sortOrderRow);

    page.add(sortGroup);

    // --- Display group ---
    const displayGroup = new Adw.PreferencesGroup({
      title: _("Display"),
      description: _("Configure how repositories are shown"),
    });

    // Panel position
    const panelRow = new Adw.ComboRow({
      title: _("Panel position"),
      subtitle: _("Where the icon appears in the top bar"),
      model: Gtk.StringList.new([_("Left"), _("Center"), _("Right")]),
    });

    const panelBoxMap = ["left", "center", "right"];
    const currentPanelBox = settings.get_string("panel-box");
    const idx = panelBoxMap.indexOf(currentPanelBox);
    panelRow.selected = idx !== -1 ? idx : 2;

    panelRow.connect("notify::selected", () => {
      settings.set_string("panel-box", panelBoxMap[panelRow.selected]);
    });
    displayGroup.add(panelRow);

    // Max repos
    const maxReposRow = new Adw.SpinRow({
      title: _("Max repositories"),
      subtitle: _("Maximum number of repositories to display"),
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 50,
        step_increment: 1,
        value: settings.get_int("max-repos"),
      }),
    });
    maxReposRow.connect("notify::value", () => {
      settings.set_int("max-repos", maxReposRow.value);
    });
    displayGroup.add(maxReposRow);

    page.add(displayGroup);

    // --- Local Projects group ---
    const localGroup = new Adw.PreferencesGroup({
      title: _("Local Projects"),
      description: _("Configure local editor for opening projects"),
    });

    // Editor command
    const editorRow = new Adw.EntryRow({
      title: _("Editor Command"),
      text: settings.get_string("local-editor"),
      show_apply_button: true,
    });
    editorRow.connect("apply", () => {
      settings.set_string("local-editor", editorRow.get_text());
    });
    localGroup.add(editorRow);

    page.add(localGroup);

    // --- Local Path Mappings group ---
    const mappingsGroup = new Adw.PreferencesGroup({
      title: _("Repository Path Mappings"),
      description: _("Manage local paths for your repositories"),
    });

    // Load existing mappings
    this._updateMappingsList(mappingsGroup, settings);

    // Add button to add new mapping
    const addMappingButton = new Gtk.Button({
      label: _("Add New Mapping"),
      halign: Gtk.Align.START,
      margin_top: 10,
    });
    addMappingButton.connect("clicked", () => {
      this._showAddMappingDialog(window, settings, mappingsGroup);
    });

    const addButtonRow = new Adw.ActionRow();
    addButtonRow.set_child(addMappingButton);
    mappingsGroup.add(addButtonRow);

    page.add(mappingsGroup);

    // --- Debug group ---
    const debugGroup = new Adw.PreferencesGroup({
      title: _("Debug"),
      description: _("Enable debug features for testing"),
    });

    // Debug mode toggle
    const debugRow = new Adw.SwitchRow({
      title: _("Debug Mode"),
      subtitle: _("Show debug button in menu to test notifications"),
      active: settings.get_boolean("debug-mode"),
    });
    debugRow.connect("notify::active", () => {
      settings.set_boolean("debug-mode", debugRow.active);
    });
    debugGroup.add(debugRow);

    page.add(debugGroup);

    window.add(page);
  }

  _updateMappingsList(group, settings) {
    // Remove all existing rows except the last one (add button)
    let child = group.get_first_child();
    const rowsToRemove = [];
    while (child) {
      if (
        child instanceof Adw.ActionRow &&
        child.get_title() !== "Add New Mapping"
      ) {
        rowsToRemove.push(child);
      }
      child = child.get_next_sibling();
    }
    rowsToRemove.forEach((row) => group.remove(row));

    try {
      const localProjectsJson = settings.get_string("local-projects");
      const localProjects = JSON.parse(localProjectsJson);

      const entries = Object.entries(localProjects);
      if (entries.length === 0) {
        const emptyRow = new Adw.ActionRow({
          title: _("No mappings configured"),
          subtitle: _('Click "Add New Mapping" to set up local paths'),
        });
        group.add(emptyRow);
        return;
      }

      for (const [repoName, path] of entries) {
        const row = new Adw.ActionRow({
          title: repoName,
          subtitle: path,
        });

        // Remove button
        const removeButton = new Gtk.Button({
          icon_name: "user-trash-symbolic",
          valign: Gtk.Align.CENTER,
          css_classes: ["destructive-action"],
        });
        removeButton.connect("clicked", () => {
          this._removeMapping(settings, repoName, group);
        });
        row.add_suffix(removeButton);

        group.add(row);
      }
    } catch (e) {
      console.log(`Error loading mappings: ${e}`);
    }
  }

  _showAddMappingDialog(parent, settings, group) {
    const dialog = new Gtk.Dialog({
      title: _("Add Repository Mapping"),
      transient_for: parent,
      modal: true,
    });

    const contentArea = dialog.get_content_area();
    contentArea.set_spacing(12);
    contentArea.set_margin_top(12);
    contentArea.set_margin_bottom(12);
    contentArea.set_margin_start(12);
    contentArea.set_margin_end(12);

    // Repository name input
    const repoBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
    });
    const repoLabel = new Gtk.Label({
      label: _("Repository (owner/name):"),
      xalign: 0,
    });
    const repoEntry = new Gtk.Entry({
      placeholder_text: "username/repository",
    });
    repoBox.append(repoLabel);
    repoBox.append(repoEntry);
    contentArea.append(repoBox);

    // Local path input
    const pathBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
    });
    const pathLabel = new Gtk.Label({
      label: _("Local Path:"),
      xalign: 0,
    });
    const pathEntry = new Gtk.Entry({
      placeholder_text: "/home/user/projects/repository",
    });

    // Browse button
    const browseBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 6,
    });
    browseBox.append(pathEntry);

    const browseButton = new Gtk.Button({
      label: _("Browse..."),
    });
    browseButton.connect("clicked", () => {
      const fileChooser = new Gtk.FileChooserDialog({
        title: _("Select Repository Path"),
        action: Gtk.FileChooserAction.SELECT_FOLDER,
        transient_for: dialog,
        modal: true,
      });
      fileChooser.add_button(_("Cancel"), Gtk.ResponseType.CANCEL);
      fileChooser.add_button(_("Select"), Gtk.ResponseType.ACCEPT);

      fileChooser.connect("response", (dialog, response) => {
        if (response === Gtk.ResponseType.ACCEPT) {
          const file = fileChooser.get_file();
          if (file) {
            pathEntry.set_text(file.get_path());
          }
        }
        fileChooser.close();
      });

      fileChooser.show();
    });
    browseBox.append(browseButton);

    pathBox.append(pathLabel);
    pathBox.append(browseBox);
    contentArea.append(pathBox);

    dialog.add_button(_("Cancel"), Gtk.ResponseType.CANCEL);
    dialog.add_button(_("Add"), Gtk.ResponseType.OK);

    dialog.connect("response", (dialog, response) => {
      if (response === Gtk.ResponseType.OK) {
        const repoName = repoEntry.get_text().trim();
        const path = pathEntry.get_text().trim();

        if (repoName && path) {
          this._addMapping(settings, repoName, path, group);
        }
      }
      dialog.close();
    });

    dialog.show();
  }

  _addMapping(settings, repoName, path, group) {
    try {
      const localProjectsJson = settings.get_string("local-projects");
      const localProjects = JSON.parse(localProjectsJson);
      localProjects[repoName] = path;
      settings.set_string("local-projects", JSON.stringify(localProjects));
      this._updateMappingsList(group, settings);
    } catch (e) {
      console.log(`Error adding mapping: ${e}`);
    }
  }

  _removeMapping(settings, repoName, group) {
    try {
      const localProjectsJson = settings.get_string("local-projects");
      const localProjects = JSON.parse(localProjectsJson);
      delete localProjects[repoName];
      settings.set_string("local-projects", JSON.stringify(localProjects));
      this._updateMappingsList(group, settings);
    } catch (e) {
      log(`Error removing mapping: ${e}`);
    }
  }
}
