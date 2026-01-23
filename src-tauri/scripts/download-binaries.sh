#!/bin/bash
# Download CLIProxyAPI binaries for the specified target

set -e

BINARY_NAME="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"

# Use patched fork until upstream merges fixes (#730, #731, #732)
CLIPROXYAPI_REPO="${CLIPROXYAPI_REPO:-router-for-me/CLIProxyAPI}"

# Get latest version from GitHub API
VERSION=$(curl -s "https://api.github.com/repos/${CLIPROXYAPI_REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
if [ -z "$VERSION" ]; then
	echo "Error: Could not fetch latest version from ${CLIPROXYAPI_REPO}"
	exit 1
fi
echo "Using CLIProxyAPI version: $VERSION"

# Map Tauri target to CLIProxyAPI asset name (bash 3 compatible - no associative arrays)
get_asset_info() {
	local target="$1"
	case "$target" in
	cli-proxy-api-aarch64-apple-darwin | cliproxyapi-aarch64-apple-darwin)
		echo "CLIProxyAPI_${VERSION}_darwin_arm64.tar.gz|tar"
		;;
	cli-proxy-api-x86_64-apple-darwin | cliproxyapi-x86_64-apple-darwin)
		echo "CLIProxyAPI_${VERSION}_darwin_amd64.tar.gz|tar"
		;;
	cli-proxy-api-x86_64-unknown-linux-gnu | cliproxyapi-x86_64-unknown-linux-gnu)
		echo "CLIProxyAPI_${VERSION}_linux_amd64.tar.gz|tar"
		;;
	cli-proxy-api-aarch64-unknown-linux-gnu | cliproxyapi-aarch64-unknown-linux-gnu)
		echo "CLIProxyAPI_${VERSION}_linux_arm64.tar.gz|tar"
		;;
	cli-proxy-api-x86_64-pc-windows-msvc.exe | cliproxyapi-x86_64-pc-windows-msvc.exe)
		echo "CLIProxyAPI_${VERSION}_windows_amd64.zip|zip"
		;;
	cli-proxy-api-aarch64-pc-windows-msvc.exe | cliproxyapi-aarch64-pc-windows-msvc.exe)
		echo "CLIProxyAPI_${VERSION}_windows_arm64.zip|zip"
		;;
	*)
		echo ""
		;;
	esac
}

mkdir -p "$BINARIES_DIR"

if [ -n "$BINARY_NAME" ]; then
	# Download specific binary
	ASSET_INFO=$(get_asset_info "$BINARY_NAME")
	if [ -z "$ASSET_INFO" ]; then
		echo "Unknown target: $BINARY_NAME"
		exit 1
	fi

	ASSET_NAME="${ASSET_INFO%|*}"
	ARCHIVE_TYPE="${ASSET_INFO#*|}"

	echo "Downloading $ASSET_NAME for $BINARY_NAME..."
	URL="https://github.com/${CLIPROXYAPI_REPO}/releases/download/v${VERSION}/${ASSET_NAME}"

	TEMP_DIR=$(mktemp -d)
	trap "rm -rf $TEMP_DIR" EXIT

	if ! curl -L -f -o "$TEMP_DIR/$ASSET_NAME" "$URL"; then
		echo "Failed to download: $URL"
		exit 1
	fi

	cd "$TEMP_DIR"
	if [ "$ARCHIVE_TYPE" = "zip" ]; then
		unzip -q "$ASSET_NAME"
	else
		tar -xzf "$ASSET_NAME"
	fi

	# Find the binary (it might be in a nested folder, or named differently)
	BINARY_FILE=$(find . -maxdepth 2 \( -name "CLIProxyAPI*" -o -name "cli-proxy-api" -o -name "cli-proxy-api.exe" \) -type f \( -perm -u+x -o -name "*.exe" \) | head -n 1)

	if [ -n "$BINARY_FILE" ]; then
		cp "$BINARY_FILE" "$BINARIES_DIR/$BINARY_NAME"
		chmod +x "$BINARIES_DIR/$BINARY_NAME"
	else
		echo "Binary not found in archive"
		ls -R
		exit 1
	fi

	echo "Downloaded to $BINARIES_DIR/$BINARY_NAME"
else
	# Download all binaries
	for target in \
		"cliproxyapi-aarch64-apple-darwin" \
		"cliproxyapi-x86_64-apple-darwin" \
		"cliproxyapi-x86_64-unknown-linux-gnu" \
		"cliproxyapi-x86_64-pc-windows-msvc.exe"; do
		if [ ! -f "$BINARIES_DIR/$target" ]; then
			"$0" "$target" || echo "Warning: Failed to download $target"
		fi
	done
fi
