# Development Guide - GitHub Tray Extension

## 🚀 Quick Start

```bash
# From project root directory:

# 1. Install the extension
make install

# 2. Logout and login (Wayland requires this)

# 3. Enable the extension
gnome-extensions enable github-tray@debba.github.com
```

**Note:** GNOME Shell 49+ on Wayland requires logout/login to detect new extensions.

## 🔧 Development Workflow

### Method 1: GNOME Shell Nested (Recommended for Wayland)

**Advantages:**
- ✅ No need to restart your main session
- ✅ Isolated testing environment
- ✅ Can crash without problems
- ✅ Works on Wayland

**How to use:**

```bash
# Terminal 1: Start GNOME Shell nested
./dev/test-nested.sh

# Terminal 2: Monitor logs (optional)
./dev/dev-logs.sh
```

In the nested window:
1. The extension loads automatically if installed
2. You can open preferences: `gnome-extensions prefs github-tray@debba.github.com`
3. To reload after changes: close and reopen the nested window

### Method 2: Reload Extension (For minor changes)

**Advantages:**
- ⚡ Fast for small changes
- ✅ No need to restart anything

**How to use:**

```bash
# After modifying the code
./dev/reload-extension.sh
```

⚠️ **Note:** Some changes (CSS, metadata.json) might require a complete restart.

### Method 3: Restart GNOME Shell (X11 only)

**Only for X11:**
```bash
# Alt+F2, type 'r' and press Enter
```

⚠️ **Does not work on Wayland** - use nested instead.

## 🐛 Debugging

### View Real-time Logs

```bash
./dev/dev-logs.sh
```

Or manually:
```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

### Looking Glass (JavaScript Console)

1. Press `Alt+F2`
2. Type `lg` and press Enter
3. Go to the "Extensions" tab to see your extension
4. In the console you can execute JavaScript:
   ```javascript
   // Example: access the extension
   let ext = Main.extensionManager.lookup('github-tray@debba.github.com');
   log(ext.state);
   ```

### Debug CSS

To check if CSS is loaded:

```bash
# Check temporary CSS files
ls -la /tmp/*github-tray*.css

# Or in Looking Glass:
St.ThemeContext.get_for_stage(global.stage).get_theme()
```

## 📝 Checklist Before Committing

```bash
# 1. Test in nested
./dev/test-nested.sh

# 2. Check for errors in logs
./dev/dev-logs.sh

# 3. Verify the extension loads correctly
gnome-extensions info github-tray@debba.github.com

# 4. Test all features:
#    - Open menu
#    - Click repositories
#    - Refresh
#    - Settings
#    - Notifications
```

## 🔍 Useful Commands

```bash
# List all extensions
gnome-extensions list

# Extension info
gnome-extensions info github-tray@debba.github.com

# Disable/Enable
gnome-extensions disable github-tray@debba.github.com
gnome-extensions enable github-tray@debba.github.com

# Open preferences
gnome-extensions prefs github-tray@debba.github.com

# Remove extension
rm -rf ~/.local/share/gnome-shell/extensions/github-tray@debba.github.com
```

## 🎨 Testing CSS

If you modify CSS:

1. **Modify** `stylesheet.css`
2. **Reload** the extension:
   ```bash
   ./dev/reload-extension.sh
   ```
3. **Verify** that styles are applied

If CSS is not applied:
- Check that the `/tmp/` directory contains the generated CSS
- Verify logs for CSS syntax errors
- Try in nested for a clean environment

## 🚨 Troubleshooting

### Extension doesn't load

```bash
# Check errors
journalctl -f -o cat /usr/bin/gnome-shell | grep -i error

# Verify all files are present
ls -la ~/.local/share/gnome-shell/extensions/github-tray@debba.github.com/

# Recompile schemas
glib-compile-schemas ~/.local/share/gnome-shell/extensions/github-tray@debba.github.com/schemas/
```

### CSS not applied

```bash
# Verify that style.js loads the CSS
ls -la /tmp/*css

# Check CSS errors in logs
./dev/dev-logs.sh
```

### Nested doesn't start

```bash
# Verify dependencies
which gnome-shell
dbus-run-session --version

# Try with more debug
MUTTER_DEBUG=1 dbus-run-session -- gnome-shell --nested --wayland
```

## 📚 Resources

- [GNOME Shell Extensions Documentation](https://gjs.guide/extensions/)
- [GJS API Documentation](https://gjs-docs.gnome.org/)
- [St (Shell Toolkit) Reference](https://gjs-docs.gnome.org/st12/)
- [Example Extensions](https://github.com/icedman/search-light)

## 🎯 Best Practices

1. **Always test in nested** before committing
2. **Monitor logs** during development
3. **Use Looking Glass** for interactive debugging
4. **Clean up resources** in the `disable()` method
5. **Validate CSS** before reloading
6. **Document** significant changes

---

**Happy coding! 🎉**
