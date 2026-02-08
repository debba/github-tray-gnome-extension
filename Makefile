UUID = github-tray@debba.github.com
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS_DIR = schemas
LOCALE_DIR = locale

all: build

build: translations

translations:
	@for po in po/*.po; do \
		lang=$$(basename $$po .po); \
		mkdir -p $(LOCALE_DIR)/$$lang/LC_MESSAGES; \
		msgfmt -o $(LOCALE_DIR)/$$lang/LC_MESSAGES/github-tray.mo $$po; \
	done

install: build
	mkdir -p $(INSTALL_DIR)
	cp -r extension.js metadata.json stylesheet.css $(SCHEMAS_DIR) icons $(INSTALL_DIR)
	@if [ -d $(LOCALE_DIR) ]; then cp -r $(LOCALE_DIR) $(INSTALL_DIR); fi
	@# Detect GNOME Shell version and use the appropriate import path for prefs.js
	@SHELL_VERSION=$$(gnome-shell --version | sed 's/[^0-9.]*//g' | cut -d. -f1); \
	if [ "$$SHELL_VERSION" -ge 49 ]; then \
		echo "Detected GNOME Shell $$SHELL_VERSION - using new import path"; \
		sed "s|resource:///org/gnome/shell/extensions/prefs.js|resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js|g" prefs.js > $(INSTALL_DIR)/prefs.js; \
	else \
		echo "Detected GNOME Shell $$SHELL_VERSION - using legacy import path"; \
		sed "s|resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js|resource:///org/gnome/shell/extensions/prefs.js|g" prefs.js > $(INSTALL_DIR)/prefs.js; \
	fi
	@echo "Extension installed in $(INSTALL_DIR)"
	@echo "Restart GNOME Shell to see changes."

uninstall:
	rm -rf $(INSTALL_DIR)

pack: build
	@rm -f $(UUID).zip
	zip -r $(UUID).zip extension.js metadata.json prefs.js stylesheet.css $(SCHEMAS_DIR) icons $(LOCALE_DIR)
	@echo "Package created: $(UUID).zip"

clean:
	rm -rf $(LOCALE_DIR)
	rm -f $(SCHEMAS_DIR)/gschemas.compiled
	rm -f $(UUID).zip

.PHONY: all build schemas translations install uninstall pack clean
