#!/bin/bash
# Script to install the extension in development mode

EXTENSION_UUID="github-tray@debba.github.com"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Installing extension in development mode...${NC}"

# Get project root directory (parent of dev/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Remove previous installation if exists
if [ -d "$EXTENSION_DIR" ]; then
    echo -e "${YELLOW}Removing previous installation...${NC}"
    rm -rf "$EXTENSION_DIR"
fi

# Create directory and copy only necessary extension files
echo -e "${BLUE}Copying extension files...${NC}"
mkdir -p "$EXTENSION_DIR"
cd "$PROJECT_ROOT"

# Copy only the files needed for the extension to run
cp metadata.json "$EXTENSION_DIR/"
cp extension.js "$EXTENSION_DIR/"
cp prefs.js "$EXTENSION_DIR/"
cp stylesheet.css "$EXTENSION_DIR/"

# Copy directories
cp -r icons "$EXTENSION_DIR/"
cp -r schemas "$EXTENSION_DIR/"
cp -r locale "$EXTENSION_DIR/" 2>/dev/null || true

# Compile GSettings schemas if present
if [ -d "$EXTENSION_DIR/schemas" ]; then
    echo -e "${BLUE}Compiling GSettings schemas...${NC}"
    glib-compile-schemas "$EXTENSION_DIR/schemas/"
fi

echo -e "${GREEN}✓ Extension installed in: $EXTENSION_DIR${NC}"
echo -e "${YELLOW}To enable it:${NC}"
echo -e "  gnome-extensions enable $EXTENSION_UUID"
echo -e ""
echo -e "${YELLOW}To test in nested:${NC}"
echo -e "  ./dev/test-nested.sh"
echo -e ""
echo -e "${YELLOW}To view logs:${NC}"
echo -e "  ./dev/dev-logs.sh"
