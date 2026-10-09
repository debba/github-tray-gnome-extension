import { detectChanges } from "../utils.js";

// Run with: gjs -m tests/detectChanges.js
function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

function repo(issues, pulls, extra = {}) {
  return {
    id: 1,
    name: "example",
    html_url: "https://github.com/example/example",
    stargazers_count: 10,
    forks_count: 2,
    open_issues_count: issues + pulls,
    _issuesCount: issues,
    _pullsCount: pulls,
    ...extra,
  };
}

function issueChanges(before, after) {
  return detectChanges([after], [before]).newIssues;
}

const expectedIssue = [{
  name: "example",
  diff: 1,
  html_url: "https://github.com/example/example",
}];

assertEqual(issueChanges(repo(2, 1), repo(2, 2)), [], "A new PR is not an issue");
assertEqual(issueChanges(repo(0, 1), repo(0, 2)), [], "Zero issues remains zero");
assertEqual(issueChanges(repo(2, 1), repo(3, 1)), expectedIssue, "A new issue is detected");
assertEqual(issueChanges(repo(2, 1), repo(3, 3)), expectedIssue, "PRs do not inflate the issue delta");
assertEqual(issueChanges(repo(2, 2), repo(3, 1)), expectedIssue, "Closing a PR does not hide a new issue");
assertEqual(issueChanges(repo(2, 1), repo(1, 3)), [], "Closing an issue and opening PRs does not notify");
assertEqual(
  issueChanges(repo(2, 1, { _issuesCount: undefined }), repo(2, 2, { _issuesCount: undefined })),
  [],
  "The fallback subtracts known PRs",
);
assertEqual(
  issueChanges(repo(2, 0, { _issuesCount: undefined, _pullsCount: undefined }), repo(3, 0, { _issuesCount: undefined, _pullsCount: undefined })),
  expectedIssue,
  "Legacy repository objects remain supported",
);
assertEqual(issueChanges(repo(2, 1), repo(3, 1, { id: 2 })), [], "New repositories do not notify");
assertEqual(detectChanges([repo(2, 1)], null), null, "Initial loading does not notify");

const changes = detectChanges([repo(2, 2, { stargazers_count: 12, forks_count: 3 })], [repo(2, 1)]);
assertEqual(changes.totalNewStars, 2, "Star detection is preserved");
assertEqual(changes.newForks[0].diff, 1, "Fork detection is preserved");

print("detectChanges: all regression checks passed");
