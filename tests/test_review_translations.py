import gettext
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


class ReviewTranslationTests(unittest.TestCase):
    def test_changed_labels_and_star_plurals_in_compiled_catalogs(self):
        expected = {
            "it": ("stella", "stelle"),
            "de": ("Stern", "Sterne"),
            "es": ("estrella", "estrellas"),
            "fr": ("étoile", "étoiles"),
        }
        with tempfile.TemporaryDirectory() as directory:
            for language, (singular, plural) in expected.items():
                with self.subTest(language=language):
                    output = Path(directory) / f"{language}.mo"
                    subprocess.run(
                        ["msgfmt", "--check", "-o", str(output), str(ROOT / "po" / f"{language}.po")],
                        check=True,
                    )
                    with output.open("rb") as catalog:
                        translations = gettext.GNUTranslations(catalog)
                    self.assertEqual(translations.ngettext("star", "stars", 1), singular)
                    self.assertEqual(translations.ngettext("star", "stars", 3), plural)
                    for label in ["Back", "parent", "Previous page", "Next page", "Mark as read"]:
                        translated = translations.gettext(label)
                        self.assertTrue(translated)
                        self.assertNotIn("←", translated)
                        self.assertNotIn("🔀", translated)


if __name__ == "__main__":
    unittest.main()
