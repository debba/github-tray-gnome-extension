import Soup from "gi://Soup";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_GRAPHQL_URL = "https://api.github.com/graphql";

/**
 * Returns true if the error was caused by a cancelled GCancellable.
 */
export function isCancelled(error) {
  if (error instanceof GLib.Error) {
    return error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
  }
  return false;
}

export class GitHubApi {
  constructor(httpSession, enterpriseUrl = "") {
    this._httpSession = httpSession;

    if (enterpriseUrl) {
      const base = enterpriseUrl.replace(/\/$/, "");
      this._apiUrl = `${base}/api/v3`;
      this._graphqlUrl = `${base}/api/graphql`;
    } else {
      this._apiUrl = DEFAULT_API_URL;
      this._graphqlUrl = DEFAULT_GRAPHQL_URL;
    }
  }

  /**
   * Sends a GraphQL query and returns the parsed `data` payload.
   * Throws on non-OK HTTP status; logs (but doesn't throw) on partial GraphQL errors.
   */
  async _graphql(token, query, cancellable = null) {
    const message = Soup.Message.new("POST", this._graphqlUrl);
    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Content-Type", "application/json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bodyBytes = new TextEncoder().encode(JSON.stringify({ query }));
    message.set_request_body_from_bytes(
      "application/json",
      GLib.Bytes.new(bodyBytes),
    );

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`GraphQL HTTP ${statusCode}`);
    }

    const parsed = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    if (parsed.errors) {
      console.error("[GitHubApi] GraphQL errors:", JSON.stringify(parsed.errors));
    }
    return parsed.data ?? {};
  }

  /**
   * Single GraphQL round-trip returning everything the menu needs:
   * viewer info, repositories (with open issues/PR counts), and followers.
   * Response is shaped to match the legacy REST objects so existing UI code keeps working.
   */
  async fetchMenuData(token, cancellable = null) {
    const query = `{
      viewer {
        login
        avatarUrl
        followers(first: 1) { totalCount }
        repositories(
          first: 100
          ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          totalCount
          nodes {
            databaseId
            name
            nameWithOwner
            description
            url
            isPrivate
            isFork
            owner { login }
            parent { url }
            primaryLanguage { name }
            stargazerCount
            forkCount
            updatedAt
            pushedAt
            createdAt
            issues(states: OPEN) { totalCount }
            pullRequests(states: OPEN) { totalCount }
          }
        }
        followersList: followers(first: 100) {
          nodes { databaseId login url }
        }
      }
    }`;

    const data = await this._graphql(token, query, cancellable);
    const viewer = data?.viewer ?? {};

    const repos = (viewer.repositories?.nodes ?? []).map((node) => ({
      id: node.databaseId,
      name: node.name,
      full_name: node.nameWithOwner,
      description: node.description,
      html_url: node.url,
      private: node.isPrivate,
      fork: node.isFork,
      owner: node.owner ? { login: node.owner.login } : null,
      parent: node.parent ? { html_url: node.parent.url } : null,
      language: node.primaryLanguage?.name ?? null,
      stargazers_count: node.stargazerCount,
      forks_count: node.forkCount,
      open_issues_count: (node.issues?.totalCount ?? 0) + (node.pullRequests?.totalCount ?? 0),
      updated_at: node.updatedAt,
      pushed_at: node.pushedAt,
      created_at: node.createdAt,
      _issuesCount: node.issues?.totalCount ?? 0,
      _pullsCount: node.pullRequests?.totalCount ?? 0,
    }));

    const followers = (viewer.followersList?.nodes ?? []).map((node) => ({
      id: node.databaseId,
      login: node.login,
      html_url: node.url,
    }));

    const userInfo = {
      login: viewer.login,
      avatar_url: viewer.avatarUrl,
      followers: viewer.followers?.totalCount ?? 0,
      public_repos: viewer.repositories?.totalCount ?? repos.length,
    };

    return { repos, userInfo, followers };
  }

  /**
   * Single GraphQL call returning open issues AND pull requests for a repo,
   * shaped to match the legacy REST objects consumed by `_createIssueItem`.
   */
  async fetchRepoIssuesAndPulls(token, owner, repoName, perPage = 20, cancellable = null) {
    const query = `{
      repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repoName)}) {
        issues(first: ${perPage}, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            databaseId
            number
            title
            url
            state
            updatedAt
            author { login }
            labels(first: 10) { nodes { name color } }
          }
        }
        pullRequests(first: ${perPage}, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            databaseId
            number
            title
            url
            state
            updatedAt
            isDraft
            author { login }
            labels(first: 10) { nodes { name color } }
          }
        }
      }
    }`;

    const data = await this._graphql(token, query, cancellable);
    const repo = data?.repository ?? {};

    const shape = (node) => ({
      id: node.databaseId,
      number: node.number,
      title: node.title,
      html_url: node.url,
      state: (node.state || "OPEN").toLowerCase(),
      updated_at: node.updatedAt,
      user: node.author ? { login: node.author.login } : null,
      labels: (node.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color })),
      draft: node.isDraft ?? false,
    });

    return {
      issues: (repo.issues?.nodes ?? []).map(shape),
      pulls: (repo.pullRequests?.nodes ?? []).map(shape),
    };
  }

  async fetchNotifications(token, perPage = 100, cancellable = null) {
    const message = Soup.Message.new(
      "GET",
      `${this._apiUrl}/notifications?per_page=${perPage}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async markNotificationRead(token, threadId, cancellable = null) {
    const message = Soup.Message.new(
      "PATCH",
      `${this._apiUrl}/notifications/threads/${threadId}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );

    const statusCode = message.get_status();
    // GitHub API returns 205 Reset Content for marking notifications as read
    if (statusCode !== 205 && statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }
  }

  async fetchRepoWorkflowRuns(token, owner, repo, perPage = 10, cancellable = null) {
    // Fetch workflow runs for a specific repository
    const url = `${this._apiUrl}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`;
    console.log(`[GitHubApi] Fetching workflow runs from: ${url}`);
    
    const message = Soup.Message.new("GET", url);

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );

    const statusCode = message.get_status();
    console.log(`[GitHubApi] Workflow runs API response status: ${statusCode}`);
    
    if (statusCode !== Soup.Status.OK) {
      const errorData = new TextDecoder().decode(bytes.get_data());
      console.error(`[GitHubApi] API error response: ${errorData}`);
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    const parsed = JSON.parse(data);
    
    console.log(`[GitHubApi] Parsed response - total_count: ${parsed.total_count}, workflow_runs: ${parsed.workflow_runs ? parsed.workflow_runs.length : 0}`);
    
    // Add repository info to each run for consistency
    if (parsed.workflow_runs) {
      parsed.workflow_runs.forEach((run) => {
        run.repository_full_name = `${owner}/${repo}`;
      });
    }
    
    return parsed.workflow_runs || [];
  }

  async rerunWorkflow(token, owner, repo, runId, cancellable = null) {
    const message = Soup.Message.new(
      "POST",
      `${this._apiUrl}/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.CREATED && statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    return true;
  }

  /**
   * Fetches the state (open/closed/merged) for a batch of notifications
   * that refer to Issues or Pull Requests, using a single GraphQL query.
   *
   * @param {string} token - GitHub personal access token
   * @param {Array} notifications - raw notification objects from REST API
   * @returns {Promise<Map<string, {state: string, isDraft: boolean}>>}
   *   Map keyed by notification.id with enriched state data
   */
  async fetchNotificationStates(token, notifications, cancellable = null) {
    // Build a list of notifications that have a resolvable subject URL
    const resolvable = notifications.filter((n) => {
      const type = n.subject?.type;
      return (
        (type === "Issue" || type === "PullRequest") && n.subject?.url
      );
    });

    if (resolvable.length === 0) return new Map();

    // Extract owner/repo/number from URLs like:
    // https://api.github.com/repos/{owner}/{repo}/issues/{number}
    // https://api.github.com/repos/{owner}/{repo}/pulls/{number}
    const aliases = [];
    const aliasToId = new Map();

    for (const n of resolvable) {
      const match = n.subject.url.match(
        /repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)$/,
      );
      if (!match) continue;

      const [, owner, repo, , number] = match;
      const alias = `n${n.id.replace(/\D/g, "")}`;
      aliasToId.set(alias, n.id);

      if (n.subject.type === "PullRequest") {
        aliases.push(
          `${alias}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
            pullRequest(number: ${number}) { state isDraft }
          }`,
        );
      } else {
        aliases.push(
          `${alias}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
            issue(number: ${number}) { state }
          }`,
        );
      }
    }

    if (aliases.length === 0) return new Map();

    const data = await this._graphql(
      token,
      `{ ${aliases.join("\n")} }`,
      cancellable,
    );

    const result = new Map();
    for (const [alias, notifId] of aliasToId) {
      const repoData = data?.[alias];
      if (!repoData) continue;

      const item = repoData.pullRequest ?? repoData.issue;
      if (!item) continue;

      result.set(notifId, {
        state: item.state ?? null,       // "OPEN" | "CLOSED" | "MERGED"
        isDraft: item.isDraft ?? false,
      });
    }

    return result;
  }

  sortRepositories(repos, settings) {
    const sortBy = settings.get_string("sort-by");
    const sortOrder = settings.get_string("sort-order");
    const maxRepos = settings.get_int("max-repos");

    repos.sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case "stars":
          valueA = a.stargazers_count;
          valueB = b.stargazers_count;
          break;
        case "name":
          valueA = a.name.toLowerCase();
          valueB = b.name.toLowerCase();
          break;
        case "created":
          valueA = new Date(a.created_at).getTime();
          valueB = new Date(b.created_at).getTime();
          break;
        case "pushed":
          valueA = new Date(a.pushed_at).getTime();
          valueB = new Date(b.pushed_at).getTime();
          break;
        case "updated":
        default:
          valueA = new Date(a.updated_at).getTime();
          valueB = new Date(b.updated_at).getTime();
          break;
      }

      if (sortOrder === "asc") {
        return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
      } else {
        return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
      }
    });

    repos.splice(maxRepos);
  }
}