import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class GitHubTrayPreferences extends ExtensionPreferences {

  fillPreferencesWindow(window) {
    
    let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    let UIFolderPath = `${this.path}/ui`;
    iconTheme.add_search_path(`${UIFolderPath}/icons`);
    
    const settings = this.getSettings();

    // Add header bar with support menu
    this._addHeaderBar(window);

    // --- Main page ---
    const page = new Adw.PreferencesPage({
      title: _("GitHub Tray"),
      icon_name: "folder-remote-symbolic",
    });

    // --- Welcome group ---
    const welcomeGroup = new Adw.PreferencesGroup({
      title: _("Welcome"),
    });

    const welcomeRow = new Adw.ActionRow({
      title: _("Thank you for using GitHub Tray!"),
      subtitle: _(
        "Join our Discord community or leave a star on GitHub to support the project",
      ),
    });

    // Discord button with custom icon and Discord purple color
    const discordIconPath = `${this.path}/icons/discord.svg`;
    const discordButton = new Gtk.Button({
      icon_name: "discord-symbolic",
      valign: Gtk.Align.CENTER,
      tooltip_text: _("Join Discord"),
      css_classes: ["flat"],
    });

    // Load Discord button styles from stylesheet.css
    const cssProvider = new Gtk.CssProvider();
    cssProvider.load_from_path(`${this.path}/stylesheet.css`);
    discordButton
      .get_style_context()
      .add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    discordButton.connect("clicked", () => {
      Gtk.show_uri(window, "https://discord.gg/YrZPHAwMSG", 0);
    });
    welcomeRow.add_suffix(discordButton);

    // GitHub star button
    const starButton = new Gtk.Button({
      icon_name: "github-symbolic",
      valign: Gtk.Align.CENTER,
      tooltip_text: _("Star on GitHub"),
      css_classes: ["flat"],
    });
    starButton.connect("clicked", () => {
      Gtk.show_uri(
        window,
        "https://github.com/debba/github-tray-gnome-extension",
        0,
      );
    });
    welcomeRow.add_suffix(starButton);

    welcomeGroup.add(welcomeRow);
    page.add(welcomeGroup);

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
    // Create a simple window instead of deprecated Gtk.Dialog
    const dialog = new Adw.Window({
      title: _("Add Repository Mapping"),
      transient_for: parent,
      modal: true,
      default_width: 400,
      default_height: 300,
    });

    // Create header bar
    const headerBar = new Adw.HeaderBar();

    const cancelButton = new Gtk.Button({
      label: _("Cancel"),
    });
    cancelButton.connect("clicked", () => {
      dialog.close();
    });
    headerBar.pack_start(cancelButton);

    const addButton = new Gtk.Button({
      label: _("Add"),
      css_classes: ["suggested-action"],
    });
    headerBar.pack_end(addButton);

    // Create content
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);

    const contentBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 24,
      margin_bottom: 24,
      margin_start: 24,
      margin_end: 24,
    });

    // Repository name input
    const repoEntry = new Adw.EntryRow({
      title: _("Repository (owner/name)"),
    });
    repoEntry.set_text("");
    contentBox.append(repoEntry);

    // Local path input with browse button
    const pathEntry = new Adw.EntryRow({
      title: _("Local Path"),
    });
    pathEntry.set_text("");

    const browseButton = new Gtk.Button({
      icon_name: "folder-open-symbolic",
      valign: Gtk.Align.CENTER,
      tooltip_text: _("Browse..."),
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

      fileChooser.connect("response", (chooser, response) => {
        if (response === Gtk.ResponseType.ACCEPT) {
          const file = chooser.get_file();
          if (file) {
            pathEntry.set_text(file.get_path());
          }
        }
        chooser.close();
      });

      fileChooser.show();
    });
    pathEntry.add_suffix(browseButton);
    contentBox.append(pathEntry);

    toolbarView.set_content(contentBox);
    dialog.set_content(toolbarView);

    // Add button handler
    addButton.connect("clicked", () => {
      const repoName = repoEntry.get_text().trim();
      const path = pathEntry.get_text().trim();

      if (repoName && path) {
        this._addMapping(settings, repoName, path, group);
        dialog.close();
      }
    });

    dialog.present();
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
      console.log(`Error removing mapping: ${e}`);
    }
  }

  find(n, name) {
    if (n.get_name() == name) {
      return n;
    }
    let c = n.get_first_child();
    while (c) {
      let cn = this.find(c, name);
      if (cn) {
        return cn;
      }
      c = c.get_next_sibling();
    }
    return null;
  }

  _addHeaderBar(window) {
    // Load menu UI
    const builder = new Gtk.Builder();
    builder.add_from_file(`${this.path}/ui/menu.ui`);

    // Find the AdwHeaderBar in the window
    let headerbar = this.find(window, "AdwHeaderBar");
    if (!headerbar) {
      console.log("Could not find AdwHeaderBar");
      return;
    }
    headerbar.pack_start(builder.get_object("info_menu"));

    // Setup menu actions
    const actionGroup = new Gio.SimpleActionGroup();
    window.insert_action_group("prefs", actionGroup);

    // A list of actions with their associated links
    const actions = [
      {
        name: "open-project",
        link: "https://github.com/debba/github-tray-gnome-extension",
      },
      {
        name: "open-issues",
        link: "https://github.com/debba/github-tray-gnome-extension/issues",
      },
      {
        name: "open-discord",
        link: "https://discord.gg/YrZPHAwMSG",
      },
    ];

    actions.forEach((action) => {
      let act = new Gio.SimpleAction({ name: action.name });
      act.connect("activate", (_) =>
        Gtk.show_uri(window, action.link, Gdk.CURRENT_TIME),
      );
      actionGroup.add_action(act);
    });
  }
}
