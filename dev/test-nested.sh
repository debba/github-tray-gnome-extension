#!/bin/bash
# Script to test the extension in GNOME Shell nested session

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting GNOME Shell nested for testing...${NC}"

# Create an isolated D-Bus session and start GNOME Shell nested
dbus-run-session -- gnome-shell --devkit --wayland

echo -e "${GREEN}Nested session terminated${NC}"
