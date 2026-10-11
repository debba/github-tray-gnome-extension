# Development

Run a separate GNOME Shell session:

```bash
dbus-run-session -- gnome-shell --devkit --wayland
```

Run the schema check and all regression tests (requires GJS, Node.js 20 or newer, Python 3, and GLib tools):

```bash
make test
```

## Test the v19 review fixes

Run just the tests for the changed notification lifecycle and UI:

```bash
node --experimental-vm-modules --test tests/reviewFixes.test.mjs
```

The tests execute the production `ui.js` and `changeDetector.js` modules with doubles for GNOME APIs. They check notification replacement, user dismissal and cleanup without double destruction, singular and plural star counts, the star notification icon and Open action, eight workflow states, open and closed issue icons, header counters, fork links, accordion toggles, pagination, Back, and Mark as read. The Node VM modules warning is expected.

For visual testing, install the branch with `make install` in a development session and restart that Shell session. Test each font size in preferences. These checks require a real GNOME Shell and are separate from the automated tests:

1. Open the menu. Confirm the followers, repositories, stars, and language marker are visible and aligned. Open a fork's parent link and verify its icon and destination.
2. Collapse and expand both sections. With more than ten unread notifications, navigate forward and back, checking the disabled buttons on the first and last page. Mark a notification as read.
3. Open Issues, Pull Requests, and workflow runs. Check the state icons and use Back in each view. Check successful, failed, running, queued, cancelled, and skipped workflows where available. Status text must remain readable beside the icons.
4. Enable Debug Mode in preferences and use the warning button in the menu to simulate changes. Repeat if the random sample did not add stars. Confirm a star notification shows a symbolic star and a readable count, such as `demo: +3 stars` or `demo: +3 stelle` in Italian. Use Open to visit the stargazers page when exactly one repository gained stars.
5. Trigger a second notification of the same category before closing the first. Only the newest should remain. Then dismiss it manually, trigger another, and disable the extension. Confirm no GitHub Tray notifications remain and no new notification cleanup errors appear in `journalctl --user -b`.

These fixtures in Debug Mode change only the extension's in-memory snapshot. Refresh to reload the actual GitHub data.

The repository metadata is prepared for version 19. This branch does not publish a release; review and merge the PR before tagging it. GNOME Extensions assigns upload versions separately.

## Validate the release package

The `Validate extension` workflow runs on pull requests and pushes to `main`. The release workflow repeats the same checks and publishes the exact ZIP produced by the validation job only when it succeeds. Both workflows retain the Shexli JSON report as an artifact.

To run the same package check locally with Python 3.12 or newer:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r ci/requirements.txt
make pack
.venv/bin/python scripts/check_shexli.py github-tray@debba.github.com.zip
```

Errors and warnings block publication. Manual review findings remain visible in the job log and report, but do not block it. Shexli is an experimental check and does not replace GNOME's review or runtime testing.

The tool and parser versions are pinned for repeatable checks. Tree-sitter 0.26.0 crashes with the 0.25.0 JavaScript grammar on this package, so the compatible 0.25.2 core is used.

Shexli 0.2.1 also hardcodes GNOME 50 as its highest accepted version and returns success even when it finds errors. The wrapper checks the JSON findings and narrowly waives that obsolete `EGO-M-004` finding only when all declared versions are unique, stable GNOME 45–51 strings and include 51. Other metadata errors remain blocking. Remove this exception when upgrading to a Shexli version that recognizes GNOME 51.

The GNOME Extensions website runs its own analyzer, so this local exception cannot change the website's report. A submission targeting GNOME 51 may still show `EGO-M-004` there. Explain the outdated analyzer ceiling to the reviewer and keep `"51"` in the metadata; removing it would make the extension unavailable on GNOME 51. The analyzer report and the submission's review status are separate.

## Publish an update on GNOME Extensions

1. Merge the release pull request, then update your local `main` branch.
2. Download the validated `github-tray@debba.github.com.zip` from the GitHub release, or build it with `make pack` and run the check above. The ZIP contains the extension files, settings schema XML, icons, and translations. Do not upload GitHub's source archive.
3. Sign in to [extensions.gnome.org](https://extensions.gnome.org/) as the owner of GitHub Tray, then open [Add yours](https://extensions.gnome.org/upload/).
4. Upload the ZIP with the existing UUID, `github-tray@debba.github.com`. The upload updates the [existing extension](https://extensions.gnome.org/extension/9307/github-tray/). The site assigns the submission version automatically; the repository version for this release is 19.
5. Wait for review and verify that the new version is Active and lists GNOME Shell 51. The upload alone does not make a pending version available to users.

Once approved, users can update from the extension page or the Installed Extensions page using the update arrow. On Wayland, log out and back in to load the updated code.

GNOME Extensions uploads and GitHub releases are separate. The GitHub workflow only creates a release ZIP when a `v*` tag is pushed; it does not upload to extensions.gnome.org.

For the GitHub v19 release, after merging the pull request:

```bash
git switch main
git pull --ff-only origin main
git tag v19
git push origin v19
```

The pull request already bumps `metadata.json` to 19. Do not run `make release` for this release, because that target would increment it again to 20.

References: [GNOME Extensions version metadata](https://gjs.guide/extensions/overview/anatomy.html), [uploading an updated version](https://discourse.gnome.org/t/how-does-one-add-an-updated-version-to-the-gnome-shell-extensions-webpage/22207), and [updating installed extensions](https://extensions.gnome.org/about/).
