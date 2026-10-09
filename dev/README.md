# Development

Run a separate GNOME Shell session:

```bash
dbus-run-session -- gnome-shell --devkit --wayland
```

Run the issue notification regression checks:

```bash
gjs -m tests/detectChanges.js
```

## Validate the release package

The `Validate extension` workflow runs on pull requests and pushes to `main`. The release workflow repeats the same checks and publishes the exact ZIP produced by the validation job only when it succeeds. Both workflows retain the Shexli JSON report as an artifact.

To run the same package check locally with Python 3.12 or newer:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r ci/requirements.txt
make pack
.venv/bin/python scripts/check_shexli.py github-tray@debba.github.com.zip
```

Errors block publication. Warnings and manual review findings remain visible in the job log and report, but do not block it. Shexli is an experimental check and does not replace GNOME's review or runtime testing.

The tool and parser versions are pinned for repeatable checks. Tree-sitter 0.26.0 crashes with the 0.25.0 JavaScript grammar on this package, so the compatible 0.25.2 core is used.

Shexli 0.2.1 also hardcodes GNOME 50 as its highest accepted version and returns success even when it finds errors. The wrapper checks the JSON findings and narrowly waives that obsolete `EGO-M-004` finding only when all declared versions are unique, stable GNOME 45–51 strings and include 51. Other metadata errors remain blocking. Remove this exception when upgrading to a Shexli version that recognizes GNOME 51.

## Publish an update on GNOME Extensions

1. Merge the release pull request, then update your local `main` branch.
2. Download the validated `github-tray@debba.github.com.zip` from the GitHub release, or build it with `make pack` and run the check above. The ZIP contains the extension files, settings schema XML, icons, and translations. Do not upload GitHub's source archive.
3. Sign in to [extensions.gnome.org](https://extensions.gnome.org/) as the owner of GitHub Tray, then open [Add yours](https://extensions.gnome.org/upload/).
4. Upload the ZIP with the existing UUID, `github-tray@debba.github.com`. The upload updates the [existing extension](https://extensions.gnome.org/extension/9307/github-tray/). The site assigns the submission version automatically; the repository version for this release is 16.
5. Wait for review and verify that the new version is Active and lists GNOME Shell 51. The upload alone does not make a pending version available to users.

Once approved, users can update from the extension page or the Installed Extensions page using the update arrow. On Wayland, log out and back in to load the updated code.

GNOME Extensions uploads and GitHub releases are separate. The GitHub workflow only creates a release ZIP when a `v*` tag is pushed; it does not upload to extensions.gnome.org.

For the GitHub v16 release, after merging the pull request:

```bash
git switch main
git pull --ff-only origin main
git tag v16
git push origin v16
```

The pull request already bumps `metadata.json` to 16. Do not run `make release` for this release, because that target would increment it again to 17.

References: [GNOME Extensions version metadata](https://gjs.guide/extensions/overview/anatomy.html), [uploading an updated version](https://discourse.gnome.org/t/how-does-one-add-an-updated-version-to-the-gnome-shell-extensions-webpage/22207), and [updating installed extensions](https://extensions.gnome.org/about/).
