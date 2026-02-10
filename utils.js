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
      starsGained.push({ name: repo.name, diff: diff });
    }

    if (repo.open_issues_count > oldData.issues) {
      const diff = repo.open_issues_count - oldData.issues;
      newIssues.push({ name: repo.name, diff: diff });
    }

    if (repo.forks_count > oldData.forks) {
      const diff = repo.forks_count - oldData.forks;
      newForks.push({ name: repo.name, diff: diff });
    }
  }

  return {
    totalNewStars,
    starsGained,
    newIssues,
    newForks,
  };
}

export function detectNewFollowers(newFollowers, oldFollowers) {
  if (!oldFollowers) return null;

  const oldIds = new Set(oldFollowers.map((f) => f.id));
  const newFollowersList = newFollowers.filter((f) => !oldIds.has(f.id));

  return newFollowersList;
}
