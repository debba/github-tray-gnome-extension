import Soup from "gi://Soup";
import GLib from "gi://GLib";

const GITHUB_API_URL = "https://api.github.com";

export class GitHubApi {
  constructor(httpSession) {
    this._httpSession = httpSession;
  }

  async fetchUserInfo(token, username) {
    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/users/${username}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async fetchRepositories(token, username, settings) {
    const sortBy = settings.get_string("sort-by");
    const sortOrder = settings.get_string("sort-order");

    let apiSort = "updated";
    let apiDirection = sortOrder === "asc" ? "asc" : "desc";

    switch (sortBy) {
      case "stars":
        apiSort = "updated";
        break;
      case "name":
        apiSort = "full_name";
        break;
      case "created":
        apiSort = "created";
        break;
      case "pushed":
        apiSort = "pushed";
        break;
      case "updated":
      default:
        apiSort = "updated";
        break;
    }

    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/user/repos?per_page=100&sort=${apiSort}&direction=${apiDirection}&affiliation=owner,collaborator,organization_member`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async fetchFollowers(token) {
    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/user/followers?per_page=100`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async fetchRepoIssues(token, owner, repo, perPage = 10) {
    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/repos/${owner}/${repo}/issues?state=open&sort=updated&per_page=${perPage}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async fetchNotifications(token, perPage = 50) {
    const message = Soup.Message.new(
      "GET",
      `${GITHUB_API_URL}/notifications?per_page=${perPage}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const data = new TextDecoder().decode(bytes.get_data());
    return JSON.parse(data);
  }

  async markNotificationRead(token, threadId) {
    const message = Soup.Message.new(
      "PATCH",
      `${GITHUB_API_URL}/notifications/threads/${threadId}`,
    );

    message.request_headers.append("Authorization", `Bearer ${token}`);
    message.request_headers.append("Accept", "application/vnd.github.v3+json");
    message.request_headers.append("User-Agent", "GNOME-Shell-GitHub-Tray");

    const bytes = await this._httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    const statusCode = message.get_status();
    if (statusCode !== Soup.Status.OK) {
      throw new Error(`HTTP ${statusCode}`);
    }
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