import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));

// Execute the production modules with small doubles for the GNOME process APIs.
// These checks cover behavior; rendering still needs a real Shell session.
class Actor {
  constructor(props = {}) {
    Object.assign(this, props);
    this.children = props.child ? [props.child] : [];
    this.signals = new Map();
    this.actor = this;
    this.clutter_text = { set_ellipsize() {}, set_line_wrap() {} };
  }
  add_child(child) { this.children.push(child); child.parent = this; }
  set_child(child) { this.children = []; this.add_child(child); }
  get_child() { return this.children[0] ?? null; }
  get_parent() { return this.parent; }
  addMenuItem(child) { this.add_child(child); }
  removeAll() { this.children = []; }
  add_style_class_name() {}
  remove_style_class_name() {}
  set_opacity(value) { this.opacity = value; }
  set_text(value) { this.text = value; }
  connect(name, callback) {
    const handlers = this.signals.get(name) ?? [];
    handlers.push(callback);
    this.signals.set(name, handlers);
  }
  emit(name) { for (const handler of this.signals.get(name) ?? []) handler(this); }
}
class Icon extends Actor {}
class Label extends Actor {}
class Button extends Actor {}
class BoxLayout extends Actor {}
const descendants = (actor) => [actor, ...actor.children.flatMap(descendants)];
const find = (actor, className) => descendants(actor).find(
  (child) => child.style_class?.split(" ").includes(className),
);

async function environment() {
  const sources = [];
  const errors = [];
  const opened = [];
  const pending = new Map();
  let nextId = 1;
  class Source extends Actor {
    constructor(props) { super(props); this.notifications = []; this.destroyCount = 0; }
    addNotification(notification) {
      this.notifications.push(notification);
      notification.connect("destroy", () => {
        this.notifications = this.notifications.filter((n) => n !== notification);
        if (!this.destroying && this.notifications.length === 0) this.destroy();
      });
    }
    destroy() {
      assert.equal(this.destroyCount++, 0, "A source must only be destroyed once");
      this.destroying = true;
      for (const notification of [...this.notifications]) notification.destroy();
      this.emit("destroy");
    }
  }
  class Notification extends Actor {
    constructor(props) { super(props); this.destroyCount = 0; this.actions = []; }
    addAction(label, callback) { this.actions.push({ label, callback }); }
    destroy() {
      assert.equal(this.destroyCount++, 0, "A notification must only be destroyed once");
      this.emit("destroy");
    }
  }
  const schedule = (_priority, delayOrCallback, callback = delayOrCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  };
  const GLib = {
    PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
    idle_add: schedule, timeout_add: schedule,
    source_remove: (id) => pending.delete(id),
    DateTime: {
      new_now_utc: () => ({ to_unix: () => 1800000000 }),
      new_from_iso8601: (text) => ({ to_unix: () => Date.parse(text) / 1000 }),
    },
  };
  const mocks = {
    "gi://St": { default: { Icon, Label, Button, BoxLayout, Widget: Actor, ScrollView: Actor, PolicyType: { NEVER: 0, AUTOMATIC: 1 } } },
    "gi://Gio": { default: {
      Icon: { new_for_string: (path) => ({ path }) },
      AppInfo: { launch_default_for_uri: (url) => opened.push(url) },
    } },
    "gi://GLib": { default: GLib },
    "gi://Clutter": { default: { ActorAlign: { CENTER: 0, START: 1, END: 2 }, Orientation: { VERTICAL: 1 } } },
    "resource:///org/gnome/shell/ui/main.js": { messageTray: { add: (source) => sources.push(source) } },
    "resource:///org/gnome/shell/ui/messageTray.js": { Source, Notification, Urgency: { NORMAL: 1 } },
    "resource:///org/gnome/shell/ui/popupMenu.js": {
      PopupBaseMenuItem: Actor, PopupMenuSection: Actor, PopupMenuItem: Actor, PopupSeparatorMenuItem: Actor,
    },
    "resource:///org/gnome/shell/extensions/extension.js": {
      gettext: (text) => text,
      ngettext: (singular, plural, count) => count === 1 ? singular : plural,
    },
  };
  const context = vm.createContext({ console: { log() {}, error: (...args) => errors.push(args) } });
  vm.runInContext('String.prototype.format = function (...args) { let i = 0; return this.replace(/%[sd]/g, () => args[i++]); };', context);
  const modules = new Map();
  async function load(specifier, referrer = resolve(root, "entry.js")) {
    const key = specifier.startsWith(".") ? resolve(dirname(referrer), specifier) : specifier;
    if (modules.has(key)) return modules.get(key);
    let module;
    if (mocks[key]) {
      module = new vm.SyntheticModule(Object.keys(mocks[key]), function () {
        for (const [name, value] of Object.entries(mocks[key])) this.setExport(name, value);
      }, { context, identifier: key });
    } else {
      module = new vm.SourceTextModule(await readFile(key, "utf8"), { context, identifier: key });
    }
    modules.set(key, module);
    await module.link((name, parent) => load(name, parent.identifier));
    return module;
  }
  const uiModule = await load("./ui.js");
  const changeModule = await load("./changeDetector.js");
  await uiModule.evaluate();
  await changeModule.evaluate();
  const settings = {
    get_boolean: () => false,
    get_string: (name) => name === "local-projects" ? "{}" : name === "github-username" ? "demo" : "",
  };
  const indicator = { menu: { actor: new Actor(), box: new Actor(), addMenuItem() {}, close() {} } };
  const ui = new uiModule.namespace.GitHubTrayUI(indicator, settings, null, root.replace(/\/$/, ""));
  ui.buildMenu(() => {}, () => {}, () => {});
  return {
    ui, sources, errors, opened, pending,
    ...Object.fromEntries(Object.entries(changeModule.namespace)),
    flush() {
      while (pending.size) {
        const [id, callback] = pending.entries().next().value;
        pending.delete(id);
        callback();
      }
      assert.deepEqual(errors, [], "Production code must not log unexpected exceptions");
    },
  };
}

const repo = {
  id: 1, name: "demo", full_name: "demo/demo", html_url: "https://github.com/demo/demo",
  stargazers_count: 10, forks_count: 2, open_issues_count: 2, _issuesCount: 1, _pullsCount: 1,
  updated_at: "2026-10-09T08:00:00Z",
};

test("replacement and cleanup destroy each notification and source exactly once", async () => {
  const env = await environment();
  const detector = new env.ChangeDetector({ isMenuOpen: () => false });
  env.sendNotification("stars", "First", "First body");
  env.flush();
  const first = env.sources[0].notifications[0];
  env.sendNotification("stars", "Second", "Second body");
  env.sendNotification("issues", "Issue", "Issue body");
  env.flush();
  assert.equal(first.destroyCount, 1);
  assert.equal(env.sources[0].destroyCount, 1);
  detector.destroy();
  for (const source of env.sources) assert.equal(source.destroyCount, 1);
  assert.deepEqual(env.errors, []);
});

test("a user-dismissed notification is removed from tracking before replacement or disable", async () => {
  const env = await environment();
  const detector = new env.ChangeDetector({ isMenuOpen: () => false });
  env.sendNotification("stars", "Stars", "Body");
  env.flush();
  const notification = env.sources[0].notifications[0];
  notification.destroy();
  env.sendNotification("stars", "More stars", "Body");
  env.flush();
  detector.destroy();
  assert.equal(notification.destroyCount, 1);
  for (const source of env.sources) assert.equal(source.destroyCount, 1);
  assert.deepEqual(env.errors, []);
});

test("cleanup cancels debounced detection before it can create notifications", async () => {
  const env = await environment();
  const detector = new env.ChangeDetector({ isMenuOpen: () => false });
  detector.schedule([{ ...repo, stargazers_count: 11 }], [repo], [], []);
  detector.destroy();
  assert.equal(env.pending.size, 0);
  env.flush();
  assert.equal(env.sources.length, 0);
});

test("multiple repositories keep readable star counts without an ambiguous Open action", async () => {
  const env = await environment();
  const detector = new env.ChangeDetector({ isMenuOpen: () => false });
  const other = { ...repo, id: 2, name: "other" };
  detector.schedule(
    [{ ...repo, stargazers_count: 11 }, { ...other, stargazers_count: 13 }],
    [repo, other], [], [],
  );
  env.flush();
  const notification = env.sources[0].notifications[0];
  assert.equal(notification.iconName, "starred-symbolic");
  assert.equal(notification.body, "demo: +1 star\nother: +3 stars");
  assert.equal(notification.actions.length, 0);
  detector.destroy();
});

for (const delta of [1, 3]) {
  test(`a gain of ${delta} ${delta === 1 ? "star" : "stars"} has a star icon, readable count, and working Open action`, async () => {
    const env = await environment();
    const detector = new env.ChangeDetector({ isMenuOpen: () => false });
    detector.schedule([{ ...repo, stargazers_count: 10 + delta }], [repo], [], []);
    env.flush();
    const notification = env.sources[0].notifications[0];
    assert.equal(notification.iconName, "starred-symbolic");
    assert.equal(notification.body, `demo: +${delta} ${delta === 1 ? "star" : "stars"}`);
    notification.actions[0].callback();
    assert.equal(env.opened[0], `${repo.html_url}/stargazers`);
    detector.destroy();
  });
}

const workflowCases = [
  ["in_progress", null, "content-loading-symbolic", "workflow-pending"],
  ["queued", null, "alarm-symbolic", "workflow-pending"],
  ["completed", "success", "object-select-symbolic", "workflow-success"],
  ["completed", "failure", "dialog-error-symbolic", "workflow-failure"],
  ["completed", "cancelled", "process-stop-symbolic", "workflow-inactive"],
  ["completed", "skipped", "media-skip-forward-symbolic", "workflow-inactive"],
  ["completed", "timed_out", "dialog-information-symbolic", "workflow-other"],
  ["waiting", null, "dialog-information-symbolic", "workflow-other"],
];
for (const [status, conclusion, iconName, colorClass] of workflowCases) {
  test(`workflow ${conclusion ?? status} renders a symbolic icon and its status text`, async () => {
    const { ui } = await environment();
    const item = ui._createWorkflowRunItem({
      status, conclusion, name: "CI", head_branch: "main", repository_full_name: "demo/demo",
      run_started_at: "2026-10-09T08:00:00Z", updated_at: "2026-10-09T08:01:00Z",
    });
    const icon = find(item, "github-tray-workflow-status-icon");
    assert.ok(icon instanceof Icon);
    assert.equal(icon.icon_name, iconName);
    assert.ok(icon.style_class.includes(colorClass));
    assert.ok(find(item, "github-tray-workflow-status-text").text.length > 0);
  });
}

for (const state of ["open", "closed"]) {
  test(`${state} issues render the bundled state icon`, async () => {
    const { ui } = await environment();
    const item = ui._createIssueItem({ state, number: 1, title: "Example", labels: [], updated_at: repo.updated_at }, repo);
    const icon = find(item, "github-tray-issue-state-icon");
    assert.ok(icon instanceof Icon);
    assert.ok(icon.gicon.path.endsWith(`/issue-${state === "open" ? "opened" : "closed"}-symbolic.svg`));
    await access(icon.gicon.path);
  });
}

test("header counters and fork links use real icons with no emoji fallback", async () => {
  const { ui, errors } = await environment();
  ui.updateMenu([repo], "demo", { followers: 3, public_repos: 1 });
  const icons = descendants(ui._headerSection).filter((actor) => actor instanceof Icon);
  assert.ok(icons.some((icon) => icon.gicon?.path.endsWith("person-symbolic.svg")));
  assert.ok(icons.some((icon) => icon.gicon?.path.endsWith("star-symbolic.svg")));
  assert.ok(icons.some((icon) => icon.icon_name === "folder-documents-symbolic"));
  const item = ui._createRepoItem({ ...repo, fork: true, parent: { html_url: "https://github.com/upstream/demo" }, language: "JavaScript" });
  assert.ok(descendants(item).some((actor) => actor instanceof Label && actor.text === "parent"));
  const dot = find(item, "github-tray-repo-lang-dot");
  assert.ok(!(dot instanceof Label));
  assert.equal(dot.style, "background-color: #f1e05a;");
  for (const icon of descendants(item).filter((actor) => actor instanceof Icon && actor.gicon)) await access(icon.gicon.path);
  assert.deepEqual(errors, []);
});

for (const section of ["Repos", "Notifications"]) {
  test(`${section} accordion icon follows collapse and expand`, async () => {
    const { ui } = await environment();
    if (section === "Repos") ui._buildReposAccordion([repo]);
    else ui._buildNotificationsAccordion([]);
    const arrow = find(ui._headerSection, "github-tray-accordion-arrow");
    const toggle = find(ui._headerSection, "github-tray-accordion-toggle");
    assert.ok(arrow instanceof Icon);
    assert.equal(arrow.icon_name, "pan-down-symbolic");
    toggle.emit("clicked");
    assert.equal(arrow.icon_name, "pan-end-symbolic");
    toggle.emit("clicked");
    assert.equal(arrow.icon_name, "pan-down-symbolic");
  });
}

test("pager icons keep their navigation actions and first/last page limits", async () => {
  const { ui } = await environment();
  let rebuilds = 0;
  ui._rebuildNotificationsInPlace = () => rebuilds++;
  const pager = ui._createNotificationsPager([], 2, false);
  assert.equal(pager._prevBtn.get_child().icon_name, "go-previous-symbolic");
  assert.equal(pager._nextBtn.get_child().icon_name, "go-next-symbolic");
  assert.equal(pager._prevBtn.reactive, false);
  pager._nextBtn.emit("clicked");
  assert.equal(ui._notificationsPage, 1);
  ui._updatePagerControls(pager, 2);
  assert.equal(pager._nextBtn.reactive, false);
  pager._prevBtn.emit("clicked");
  assert.equal(ui._notificationsPage, 0);
  assert.equal(rebuilds, 2);
});

test("Back and Mark as read keep their actions after replacing glyphs with icons", async () => {
  const { ui } = await environment();
  let wentBack = false;
  ui.showReposView = () => { wentBack = true; };
  const back = ui._createBackButton();
  assert.equal(back.get_child().children[0].icon_name, "go-previous-symbolic");
  back.emit("clicked");
  assert.equal(wentBack, true);
  let markedRead = false;
  ui._onMarkNotificationRead = () => { markedRead = true; };
  const item = ui._createNotificationItem({ subject: { type: "Issue", title: "Example" }, repository: { full_name: "demo/demo" } });
  const markRead = find(item, "github-tray-mark-read-btn");
  assert.equal(markRead.get_child().icon_name, "object-select-symbolic");
  markRead.emit("clicked");
  assert.equal(markedRead, true);
});
