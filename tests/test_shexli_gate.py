import unittest

from scripts.check_shexli import blocking_findings


class ShexliGateTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {"shell-version": [str(v) for v in range(45, 52)]}
        self.gnome51_finding = {
            "rule_id": "EGO-M-004",
            "severity": "error",
            "message": "Field `shell-version` contains invalid values, more than one development release, or implausible future releases.",
        }

    def test_real_errors_block_even_with_known_false_positive(self):
        error = {"rule_id": "EGO-M-001", "severity": "error", "message": "Missing metadata"}
        report = {"findings": [self.gnome51_finding, error]}
        self.assertEqual(blocking_findings(report, self.metadata), [error])

    def test_valid_gnome51_is_allowed(self):
        self.assertEqual(blocking_findings({"findings": [self.gnome51_finding]}, self.metadata), [])

    def test_invalid_or_future_versions_are_not_waived(self):
        for versions in [["45", "52"], ["51", "invalid"], ["51", 50], ["51", "51"], ["50"], "51"]:
            with self.subTest(versions=versions):
                self.assertEqual(
                    blocking_findings({"findings": [self.gnome51_finding]}, {"shell-version": versions}),
                    [self.gnome51_finding],
                )

    def test_other_metadata_errors_are_not_waived(self):
        error = {**self.gnome51_finding, "message": "Missing shell-version"}
        self.assertEqual(blocking_findings({"findings": [error]}, self.metadata), [error])

    def test_warnings_and_manual_review_do_not_block(self):
        report = {"findings": [{"rule_id": "EGO-A-004", "severity": severity} for severity in ["warning", "manual_review"]]}
        self.assertEqual(blocking_findings(report, self.metadata), [])


if __name__ == "__main__":
    unittest.main()
