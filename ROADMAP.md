# GitHub Tray GNOME Extension - Roadmap

## Issue Reference
- [#1 - Allow displaying GitHub notifications](https://github.com/debba/github-tray-gnome-extension/issues/1)

---

## Done

### Repository Issues View
- [x] **API: Fetch repository issues** (`githubApi.js`)
  - `fetchRepoIssues(token, owner, repo, perPage)` - GET `/repos/{owner}/{repo}/issues`
  
- [x] **UI: Issues list view** (`ui.js`)
  - `showIssuesView(repo, issues)` - Displays issues for a repository
  - `_createIssueItem(issue, repo)` - Issue item with state, number, title, labels, author, date
  - `showReposView()` - Navigate back to repositories list
  - Back button and "Open in Browser" button
  
- [x] **Extension: Issue fetching** (`extension.js`)
  - `_fetchRepoIssues(repo, callback)` - Fetches issues on demand
  
- [x] **Styling** (`stylesheet.css`)
  - Issue item styles
  - Issue labels with background colors
  - Meta information row

### GitHub Notifications API
- [x] **API: Fetch notifications** (`githubApi.js`)
  - `fetchNotifications(token, perPage)` - GET `/notifications`
  
- [x] **API: Mark notification as read** (`githubApi.js`)
  - `markNotificationRead(token, threadId)` - PATCH `/notifications/threads/{id}`

### GitHub Notifications UI

#### Header Section
- [x] Notification badge on indicator icon (count of unread)
- [x] Notification count in header section

#### Notifications Menu
- [x] "Notifications" section in menu
- [x] List of recent notifications with:
  - Type icon (mention, review request, PR, issue)
  - Repository name
  - Subject title
  - "Open" button
  - "Mark as read" button
- [x] Click action: open in browser + mark as read

#### Settings
- [x] Toggle: "Show GitHub notifications"
- [x] Toggle per notification type:
  - Review requests
  - Mentions
  - Assignments
  - PR comments
  - Issue comments
- [x] Notification refresh interval (default: 60s)

#### GNOME Notification Center Integration
- [x] Desktop notifications for new GitHub notifications
- [x] Click action on desktop notification
- [x] "Mark as read" action button

### Font Size Customization
- [x] Font size setting (small, medium, large)
- [x] Font size UI in preferences

---

## Todo

### Enhanced Issues View
- [ ] Filter issues by label
- [ ] Filter issues by state (open/closed/all)
- [ ] Pull requests support (separate icon, merged state)
- [ ] Issue search functionality

### Repository Enhancements
- [ ] Show PR count alongside issues
- [ ] Direct link to PRs
- [ ] Show last commit info

---

## Technical Notes

### API Endpoints Used
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/repos/{owner}/{repo}/issues` | GET | Fetch repository issues |
| `/notifications` | GET | Fetch user notifications |
| `/notifications/threads/{id}` | PATCH | Mark notification as read |

### Notification Types (GitHub API)
- `Issue` - New issue opened
- `IssueComment` - Comment on issue
- `PullRequest` - PR opened/merged/closed
- `PullRequestReview` - Review submitted
- `PullRequestReviewComment` - Comment on PR diff
- `Commit` - Commit pushed
- `Release` - New release published
- `Discussion` - Discussion created/answered
- `Mention` - User mentioned
- `Assign` - User assigned
- `ReviewRequested` - Review requested from user
- `SecurityAlert` - Security vulnerability alert

---

## File Changes Summary

### Modified Files
- `githubApi.js` - Added `fetchRepoIssues`, `fetchNotifications`, `markNotificationRead`
- `ui.js` - Added issues view, notifications view, navigation, issue/notification item rendering
- `extension.js` - Added `_fetchRepoIssues`, `_loadNotifications`, `_markNotificationRead` callback integration
- `stylesheet.css` - Added issue-related styles, notification styles, font size variants
- `prefs.js` - Added notification settings, font size setting
- `schemas/org.gnome.shell.extensions.github-tray.gschema.xml` - Added notification settings, font size setting

### Future Files (planned)
- Potentially split `ui.js` into modules (repos, issues, notifications)
