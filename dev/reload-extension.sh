#!/bin/bash
# Script to quickly reload the extension

EXTENSION_UUID="github-tray@debba.github.com"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}Reloading extension...${NC}"

# Disable
echo -e "${BLUE}1. Disabling...${NC}"
gnome-extensions disable "$EXTENSION_UUID"
sleep 0.5

# Reinstall
echo -e "${BLUE}2. Reinstalling files...${NC}"
"$(dirname "$0")/install-dev.sh" > /dev/null 2>&1

# Re-enable
echo -e "${BLUE}3. Re-enabling...${NC}"
gnome-extensions enable "$EXTENSION_UUID"

echo -e "${GREEN}✓ Extension reloaded!${NC}"
echo -e "${BLUE}Check status:${NC}"
gnome-extensions info "$EXTENSION_UUID" | grep -E "(State|Version|Path)"
