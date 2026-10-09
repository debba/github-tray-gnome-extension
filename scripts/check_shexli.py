"""Analyze the release ZIP and fail on Shexli errors, preserving all findings."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile


def is_gnome51_false_positive(finding, metadata):
    # Shexli 0.2.1 hardcodes 50 as the highest supported GNOME version.
    versions = metadata.get("shell-version")
    return (
        finding["rule_id"] == "EGO-M-004"
        and finding["message"] == (
            "Field `shell-version` contains invalid values, "
            "more than one development release, or implausible future releases."
        )
        and isinstance(versions, list)
        and "51" in versions
        and all(isinstance(version, str) and version in {str(v) for v in range(45, 52)} for version in versions)
        and len(versions) == len(set(versions))
    )


def blocking_findings(report, metadata):
    return [
        finding for finding in report["findings"]
        if finding["severity"] == "error"
        and not is_gnome51_false_positive(finding, metadata)
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--report", type=Path, default=Path("shexli-report.json"))
    args = parser.parse_args()

    with zipfile.ZipFile(args.package) as package:
        metadata = json.loads(package.read("metadata.json"))

    # Shexli 0.2.1 returns zero even when its report contains errors.
    result = subprocess.run(
        [sys.executable, "-m", "shexli", "--format", "json", str(args.package)],
        check=True, capture_output=True, text=True,
    )
    report = json.loads(result.stdout)
    args.report.write_text(result.stdout, encoding="utf-8")
    errors = blocking_findings(report, metadata)
    for finding in report["findings"]:
        note = " (known GNOME 51 false positive in Shexli 0.2.1)" if is_gnome51_false_positive(finding, metadata) else ""
        print(f"{finding['rule_id']} {finding['severity']}{note}: {finding['message']}")
        for evidence in finding.get("evidence", []):
            print(f"  {evidence['path']}:{evidence.get('line') or ''}")

    summary = f"Shexli: {len(report['findings'])} findings, {len(errors)} blocking errors."
    print(summary)
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary_path, "a", encoding="utf-8") as output:
            output.write(f"### Extension package validation\n\n{summary}\n\n")
            output.write("Warnings and manual review findings remain in the JSON report and job log.\n")
            if any(is_gnome51_false_positive(f, metadata) for f in report["findings"]):
                output.write("\nShexli 0.2.1's obsolete GNOME 50 ceiling is waived only for valid GNOME 45–51 metadata.\n")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
