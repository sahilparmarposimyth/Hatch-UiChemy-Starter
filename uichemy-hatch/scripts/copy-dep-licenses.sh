#!/usr/bin/env bash
#
# Copy each prefixed dependency's licence/notice files from vendor/ into
# vendor-prefixed/, so the shipped tree carries the notices its licences
# require.
#
# WHY THIS SCRIPT EXISTS. Strauss has its own licenser (it logs "Adding
# licenses...") but as of 0.20.1 it emits nothing: Licenser::copyLicenses()
# builds both source and target paths by concatenating a directory onto a value
# that is already an absolute path (src/Pipeline/Licenser.php:83 and :98), so
# the copy never lands. Until that is fixed upstream, the notices have to be
# placed explicitly — and they must be, because vendor/ is excluded from the
# release archive while vendor-prefixed/ ships.
#
# Runs automatically after every prefix: composer.json chains it into the
# `strauss` script, which post-install-cmd and post-update-cmd both call.
#
# Mirrors whatever Strauss actually produced rather than a hardcoded package
# list, so a new prefixed dependency is covered without editing this file.
#
# Portability: BSD (macOS) and GNU find, and bash 3.2 — hence -iname patterns
# rather than -regextype, and a newline-delimited string rather than an array
# (an empty array under `set -u` is an error in bash 3.2).
#
set -eu

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VENDOR="$ROOT/vendor"
PREFIXED="$ROOT/vendor-prefixed"

if [ ! -d "$PREFIXED" ]; then
    echo "copy-dep-licenses: $PREFIXED does not exist — run strauss first." >&2
    exit 1
fi

copied=0
missing=""

# Walk vendor-prefixed/<vendor>/<package>/ — the two-level Composer layout.
while IFS= read -r pkg_dir; do
    rel="${pkg_dir#"$PREFIXED"/}"      # e.g. wordpress/mcp-adapter
    src_dir="$VENDOR/$rel"

    [ -d "$src_dir" ] || continue

    found_for_pkg=0

    # -maxdepth 1: a package's own licence, never one from a nested vendor dir.
    # Matches LICENSE, LICENCE, LICENSE.md/.txt, COPYING, COPYING.LESSER, NOTICE.
    while IFS= read -r src_file; do
        [ -n "$src_file" ] || continue
        target="$pkg_dir/$(basename "$src_file")"
        if [ ! -f "$target" ] || ! cmp -s "$src_file" "$target"; then
            cp "$src_file" "$target"
            echo "copy-dep-licenses: $rel/$(basename "$src_file")"
            copied=$((copied + 1))
        fi
        found_for_pkg=1
    done < <( find "$src_dir" -maxdepth 1 -type f \
                  \( -iname 'licen[cs]e' -o -iname 'licen[cs]e.*' \
                     -o -iname 'copying' -o -iname 'copying.*' \
                     -o -iname 'notice' -o -iname 'notice.*' \) )

    if [ "$found_for_pkg" -eq 0 ]; then
        missing="${missing}${rel}
"
    fi
done < <( find "$PREFIXED" -mindepth 2 -maxdepth 2 -type d )

# A prefixed package with no discoverable licence file is a compliance problem,
# not a cosmetic one — it ships in the archive and cannot be attributed. Fail
# the build rather than let it through silently.
if [ -n "$missing" ]; then
    echo "ERROR: these prefixed packages ship with no licence file in vendor/:" >&2
    printf '  - %s\n' $missing >&2
    echo "Add the upstream licence text before releasing." >&2
    exit 1
fi

if [ "$copied" -eq 0 ]; then
    echo "copy-dep-licenses: licences already up to date."
else
    echo "copy-dep-licenses: $copied file(s) copied."
fi
