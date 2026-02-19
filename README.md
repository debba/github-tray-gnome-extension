[![Discord](https://img.shields.io/discord/1470772941296894128?color=5865F2&logo=discord&logoColor=white)](https://discord.gg/YrZPHAwMSG)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%2B-blue)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20IT%20%7C%20DE%20%7C%20ES%20%7C%20FR-green)

# GitHub Tray GNOME Extension

A GNOME Shell extension that puts your GitHub repos right in your top bar. Check stars, issues, notifications, and workflow runs without opening a browser.

![GitHub Tray Gnome Extension Screenshot](screenshots/overview.png)

**Discord** - [Join our Discord server](https://discord.gg/YrZPHAwMSG) and chat with the maintainers.

## What it does

### Repositories

- Shows your repos (owned, collaborated, and organization repos) in a dropdown with GitHub-style UI
- Each repo displays stars, forks, open issues, language with official color dot, and last update time
- Repository descriptions are shown below the stats
- Click a repo to open it on GitHub, or in your local editor if you've mapped a path
- Click the stars counter to open the stargazers page, click forks to open the network members page
- Links to the Issues view and fork parent directly from the menu
- Sort by stars, name, last updated, last pushed, or created date — ascending or descending
- Limit how many repos to display (1–50, default 10)
- Layout switches to collapsible accordion sections when both repos and notifications are active

### Header

- Shows your avatar, username (clickable — opens your GitHub profile), followers count, public repo count, and total stars
- Badge on the panel icon with unread notification count (capped at 99+)

### GitHub Notifications

- Dedicated notifications section inside the menu, separate from desktop alerts
- Each notification shows a contextual Octicon SVG icon by subject type (Issue, PR, Commit, Release, Discussion, Mention, Assignment, Review Request, Security Alert)
- Issue and PR notifications include a real-time state badge fetched via GraphQL: **Open**, **Closed**, **Merged**, **Draft**
- Paginated list (10 per page) with ← / → navigation
- Click a notification to open it in the browser — it's automatically marked as read
- Mark individual notifications as read with the inline ✓ button, without leaving the menu
- "Open All" button opens `github.com/notifications`
- Desktop alerts for new notifications (configurable, separate from workflow alerts)
- Filter which notification types appear: Review Requests, Mentions, Assignments, Pull Request Comments, Issue Comments

### Issues view

- Click the issues counter on any repo to open an inline Issues view without leaving the menu
- Shows open issues with: number, title, status icon, colored labels (with original GitHub colors), author, and relative date
- Supports more than 4 labels per issue (shows "+N" overflow)
- "Open in Browser" button opens the repo's issues page
- "← Back" returns to the main menu

### GitHub Actions

- Monitor recent workflow runs per repository directly in the menu
- Workflow icon on each repo opens an inline Workflow Runs view
- Each run shows: workflow name, status badge (Success, Failed, In progress, Queued, Cancelled, Skipped, Completed), and duration
- "Re-run" button on failed workflows to trigger them again without opening GitHub
- "Open in Browser" opens the repo's Actions page
- Desktop notifications when workflows start, succeed, fail, or are cancelled
- Notifications are only sent for repos with a configured local path

### Other

- Auto-refresh with configurable intervals (repositories and notifications use separate timers)
- Desktop notifications when repos gain new stars, issues, forks, or new followers
- Waiting screen when network is unavailable — loads automatically when connection is restored
- Menu updates are queued while open and applied after closing to avoid flicker
- All numbers use abbreviated formatting: 1500 → 1.5k, 2M → 2.0M
- All dates shown as relative time: "just now", "5 min ago", "3 h ago", etc.
- Available in English, Italian, German, Spanish, and French

## Requirements

- GNOME Shell 45+
- libsoup3 (usually pre-installed)

## Installation

```bash
git clone https://github.com/debba/github-tray-gnome-extension.git
cd github-tray-gnome-extension
make install
```

Then reload GNOME Shell:

- **X11**: Alt+F2, type `r`, Enter
- **Wayland**: log out and back in

Enable the extension:

```bash
gnome-extensions enable github-tray@debba.github.com
```

## Setup

Click the GitHub icon in the top bar → Settings and fill in:

- Your GitHub username
- A personal access token

### Getting a token

Go to [github.com/settings/tokens](https://github.com/settings/tokens) and create a new classic token.

Required scopes:

- `repo` — for private repos and GitHub Actions access
- Or `public_repo` — for public repos only

> **Note**: The `repo` scope covers GitHub Actions. There is no separate `actions:read` scope.

Copy the token and paste it in Settings.

### Local projects

Open repos directly in your editor:

1. Set your editor command in Settings (default: `code`)
2. Right-click any repo → "Set local path"
3. Pick the folder where you cloned it
4. Clicking that repo now opens it in your editor instead of the browser

Or manage all mappings in Settings → Repository Path Mappings.

### GitHub Actions

The extension monitors workflow runs automatically:

- Click the workflow icon on any repo to open the Workflow Runs view
- Re-run failed workflows directly from the menu
- Configure in Settings → GitHub Actions:
  - Maximum number of workflow runs to display
  - Toggle desktop notifications for: start, success, failure, cancelled

Workflow desktop notifications are only sent for repos with a configured local path.

### Notifications

Configure in Settings → Notifications:

- **Show GitHub Notifications**: display unread notifications in the menu
- **Desktop Notifications**: send a system alert when new notifications arrive
- **Refresh Interval**: how often to check (30–600 seconds, default 60)
- **Notification Types**: toggle which reasons appear — Review Requests, Mentions, Assignments, Pull Request Comments, Issue Comments

### Display settings

- **Panel position**: Left, Center, or Right in the top bar (applied dynamically, no restart needed)
- **Max repositories**: how many repos to show (1–50)
- **Font size**: Small, Medium, or Large text in the menu

## Package it

```bash
make pack
```

Creates `github-tray@debba.github.com.zip` ready for distribution or upload to extensions.gnome.org.

## Troubleshooting

**Nothing shows up?**

```bash
# Check it's enabled
gnome-extensions list --enabled

# Watch the logs
journalctl -f -o cat /usr/bin/gnome-shell
```

**Error loading repos?**

- Double-check your username and token in Settings
- The token may have expired — generate a new one

**Can't pick a local path?**

- Install zenity: `sudo apt install zenity` / `sudo pacman -S zenity` / `sudo dnf install zenity`

**Notifications not showing up?**

- Make sure "Show GitHub Notifications" is enabled in Settings
- Check that the relevant notification type toggles are on (Review Requests, Mentions, etc.)

## Development

```bash
make install
# Reload shell (Alt+F2 → r on X11, or logout on Wayland)
```

Enable Debug Mode in Settings to add a ⚠️ button in the menu header. Pressing it simulates random changes to stars, issues, forks, and followers to test desktop notifications without waiting for real events.

## License

MIT License - see [LICENSE](LICENSE) file for details
