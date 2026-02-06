# GitHub Tray Extension

GNOME Shell extension that adds a tray icon showing your GitHub repositories with stars, issues, forks, and language info.

## Features

- GitHub icon in the top panel (system tray)
- Lists your repositories sorted by last updated
- For each repository shows:
  - Name (bold) + programming language with color dot
  - Stars, open issues, forks count
  - Relative last-update time (e.g. "3h ago")
  - Description (truncated)
- Click any repo to open it in your browser
- Auto-refresh every 5 minutes + manual refresh button
- Star change notifications with badge indicator
- Total stars count in the header
- Configurable panel position (left/center/right) and max repos
- English UI with Italian translation included

## Requirements

- GNOME Shell 45, 46, 47, or 48
- libsoup3 (usually pre-installed)

## Installation

### Method 1: Using Makefile

```bash
git clone https://github.com/debba/github-tray-extension.git
cd github-tray-extension
make install
```

Then restart GNOME Shell and enable the extension:

```bash
gnome-extensions enable github-tray@extension
```

### Method 2: Manual

1. Compile schemas:
   ```bash
   glib-compile-schemas schemas/
   ```
2. Copy to the extensions directory:
   ```bash
   cp -r . ~/.local/share/gnome-shell/extensions/github-tray@extension
   ```
3. Restart GNOME Shell (Alt+F2 then `r` on X11, or log out/in on Wayland)
4. Enable the extension:
   ```bash
   gnome-extensions enable github-tray@extension
   ```

## Configuration

1. Click the GitHub icon in the top bar
2. Click **Settings**
3. Enter your:
   - **GitHub Username**
   - **Personal Access Token** (press Enter/Apply to save)

### How to create a Personal Access Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a name
4. Select scope:
   - `repo` - for private and public repositories
   - `public_repo` - for public repositories only
5. Generate and copy the token

## Building a distributable package

```bash
make pack
```

This creates `github-tray@extension.zip` ready for distribution or upload to extensions.gnome.org.

## File structure

```
github-tray-extension/
├── extension.js          # Main extension logic
├── metadata.json         # Extension metadata
├── prefs.js              # Preferences UI (libadwaita)
├── schemas/
│   └── ...gschema.xml    # GSettings schema
├── po/
│   └── it.po             # Italian translation
├── Makefile              # Build, install, pack
└── README.md
```

## Troubleshooting

**Icon doesn't appear:**
- Check the extension is enabled: `gnome-extensions list --enabled`
- Check logs: `journalctl -f -o cat /usr/bin/gnome-shell`

**"Error loading repositories":**
- Verify username and token are correct
- Make sure the token is not expired
- Check logs for details

**Missing icon:**
- If `github-symbolic` is not in your icon theme, a fallback icon is used automatically

## Development

1. Edit source files
2. Run `make install`
3. Restart GNOME Shell
4. Check logs: `journalctl -f -o cat /usr/bin/gnome-shell`

---

## Italiano

Estensione per GNOME Shell che aggiunge un'icona nella barra di sistema per visualizzare i tuoi repository GitHub con stelle, issues, fork e linguaggio.

Per installare: `make install` e poi riavvia GNOME Shell.

La configurazione si trova cliccando sull'icona > **Impostazioni** (Settings).

Serve un Personal Access Token da [GitHub Settings](https://github.com/settings/tokens) con scope `repo` o `public_repo`.

## License

MIT License
