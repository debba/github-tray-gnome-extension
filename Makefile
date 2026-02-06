UUID = github-tray@extension
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS_DIR = schemas
LOCALE_DIR = locale

all: build

build: schemas translations

schemas:
	glib-compile-schemas $(SCHEMAS_DIR)

translations:
	@for po in po/*.po; do \
		lang=$$(basename $$po .po); \
		mkdir -p $(LOCALE_DIR)/$$lang/LC_MESSAGES; \
		msgfmt -o $(LOCALE_DIR)/$$lang/LC_MESSAGES/github-tray.mo $$po; \
	done

install: build
	mkdir -p $(INSTALL_DIR)
	cp -r extension.js metadata.json prefs.js $(SCHEMAS_DIR) $(INSTALL_DIR)
	@if [ -d $(LOCALE_DIR) ]; then cp -r $(LOCALE_DIR) $(INSTALL_DIR); fi
	@echo "Extension installed in $(INSTALL_DIR)"
	@echo "Restart GNOME Shell to see changes."

uninstall:
	rm -rf $(INSTALL_DIR)

pack: build
	@rm -f $(UUID).zip
	zip -r $(UUID).zip extension.js metadata.json prefs.js $(SCHEMAS_DIR) $(LOCALE_DIR)
	@echo "Package created: $(UUID).zip"

clean:
	rm -rf $(LOCALE_DIR)
	rm -f $(SCHEMAS_DIR)/gschemas.compiled
	rm -f $(UUID).zip

.PHONY: all build schemas translations install uninstall pack clean
