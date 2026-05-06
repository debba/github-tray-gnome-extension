import GLib from "gi://GLib";

export function formatNumber(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  else if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

export function relativeTime(isoString) {
  if (!isoString) return "";
  const now = GLib.DateTime.new_now_utc().to_unix();
  const then = GLib.DateTime.new_from_iso8601(isoString, null)?.to_unix() ?? 0;
  const diffSec = now - then;

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} d ago`;
  return `${Math.floor(diffSec / 2592000)} mo ago`;
}

export function detectChanges(newRepos, oldRepos) {
  if (!oldRepos) return null;

  const oldMap = new Map(
    oldRepos.map((r) => [
      r.id,
      {
        stars: r.stargazers_count,
        issues: r.open_issues_count,
        forks: r.forks_count,
        name: r.name,
      },
    ]),
  );

  let totalNewStars = 0;
  const starsGained = [];
  const newIssues = [];
  const newForks = [];

  for (const repo of newRepos) {
    const oldData = oldMap.get(repo.id);
    if (!oldData) continue;

    if (repo.stargazers_count > oldData.stars) {
      const diff = repo.stargazers_count - oldData.stars;
      totalNewStars += diff;
      starsGained.push({ name: repo.name, diff: diff, html_url: repo.html_url });
    }

    if (repo.open_issues_count > oldData.issues) {
      const diff = repo.open_issues_count - oldData.issues;
      newIssues.push({ name: repo.name, diff: diff, html_url: repo.html_url });
    }

    if (repo.forks_count > oldData.forks) {
      const diff = repo.forks_count - oldData.forks;
      newForks.push({ name: repo.name, diff: diff, html_url: repo.html_url });
    }
  }

  return {
    totalNewStars,
    starsGained,
    newIssues,
    newForks,
  };
}

/**
 * Converts a GitHub REST API subject URL to its corresponding web URL.
 * Supports both github.com and GitHub Enterprise Server.
 * e.g. https://api.github.com/repos/owner/repo/pulls/1 → https://github.com/owner/repo/pull/1
 * e.g. https://ghe.example.com/api/v3/repos/owner/repo/pulls/1 → https://ghe.example.com/owner/repo/pull/1
 *
 * @param {string|null|undefined} apiUrl
 * @param {string} enterpriseUrl - base URL of the GHE instance, or empty for github.com
 * @param {string|null|undefined} subjectType - notification subject type
 * @returns {string|null}
 */
export function subjectApiToWebUrl(apiUrl, enterpriseUrl = "", subjectType = null) {
  if (!apiUrl) return null;

  let webUrl;
  if (enterpriseUrl) {
    const base = enterpriseUrl.replace(/\/$/, "");
    webUrl = apiUrl.replace(`${base}/api/v3/repos/`, `${base}/`);
  } else {
    webUrl = apiUrl.replace("https://api.github.com/repos/", "https://github.com/");
  }

  const isPullRequest =
    subjectType === "PullRequest" ||
    subjectType === "PullRequestReview" ||
    subjectType === "PullRequestReviewComment";
  if (isPullRequest) {
    webUrl = webUrl.replace(/\/(issues|pulls)\/(\d+).*$/, "/pull/$2");
  }

  return webUrl.replace(/\/commits\/([a-f0-9]+)$/, "/commit/$1");
}

export function detectNewFollowers(newFollowers, oldFollowers) {
  if (!oldFollowers) return null;

  const oldIds = new Set(oldFollowers.map((f) => f.id));
  const newFollowersList = newFollowers.filter((f) => !oldIds.has(f.id));

  return newFollowersList;
}
