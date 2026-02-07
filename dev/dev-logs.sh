#!/bin/bash
# Script to monitor extension logs

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Monitoring GNOME Shell logs...${NC}"
echo -e "${GREEN}Press Ctrl+C to stop${NC}"
echo ""

# Show GNOME Shell logs filtering for the extension
journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered -E "(github-tray|GitHubTray|JS ERROR)"
