# Development

Run a separate GNOME Shell session:

```bash
dbus-run-session -- gnome-shell --devkit --wayland
```

Run the issue notification regression checks:

```bash
gjs -m tests/detectChanges.js
```

## Publish an update on GNOME Extensions

1. Merge the release pull request, then update your local `main` branch.
2. Run `make pack`. The resulting `github-tray@debba.github.com.zip` contains the extension files, settings schema, icons, and translations. Do not upload GitHub's source archive.
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
