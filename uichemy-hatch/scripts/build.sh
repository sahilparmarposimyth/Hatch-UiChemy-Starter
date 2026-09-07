#!/usr/bin/env bash
#
# Build the distributable UiChemy plugin zip.
#
# The archive's top-level folder is always `uichemy`, because that is the
# directory name WordPress installs into and the name plugin_basename() bakes
# into update checks. That is independent of what this checkout happens to be
# called locally (uichemy-wordpress, a worktree, a fork), so the tree is staged
# into a temp directory named `uichemy` and zipped from there rather than zipping
# the checkout in place.
#
set -eu

# Run from the plugin root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

COMMIT_HASH=$(git rev-parse --short HEAD)

# Pull the version straight from the UICH_VERSION define in uichemy.php.
VERSION="v$(sed -n "s/.*define( *'UICH_VERSION', *'\([^']*\)' *).*/\1/p" uichemy.php)"

OUT="${OUT:-$HOME/Desktop/uichemy-wp-${VERSION}-${COMMIT_HASH}.zip}"
rm -f "$OUT"

# Build the React bundles the plugin ships (new-dashboard/build/).
( cd new-dashboard && [ -d node_modules ] || npm ci; npm run build )

# The merged Hatch runtime has a React admin of its own (hatch/build/admin/).
# Without it every Hatch screen renders an empty mount point, so it is built
# here rather than left to whoever remembers.
( cd hatch && [ -d node_modules ] || npm ci; npm run build:admin )

# Regenerate THIRD-PARTY-LICENSES.txt from the bundles just built, so the
# shipped notice can never drift from the shipped code. Derives its package
# list from webpack's own module graph and exits non-zero if any bundled
# package has no determinable licence.
( cd new-dashboard && npm run licenses )

# Ensure each prefixed PHP dependency carries its upstream licence file.
# vendor/ is excluded from the archive below, so a notice left only there
# would not ship. Exits non-zero if a prefixed package has no licence.
bash scripts/copy-dep-licenses.sh

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# What NOT to ship. Runtime PHP dependencies live in vendor-prefixed/, so
# vendor/ (the un-prefixed dev copy) is excluded while vendor-prefixed/ stays.
# new-dashboard/ is excluded wholesale and its build/ output added back, so the
# React source and node_modules never reach the archive.
#
# Every directory exclusion is ROOT-ANCHORED with a leading slash. An unanchored
# rsync pattern matches at any depth, and the plugin has PHP living in
# includes/new-dashboard/ — an unanchored `new-dashboard` silently drops it and
# produces a zip that fatals on activation.
#
# The merged Hatch runtime (hatch/) follows the same rule: its React source and
# toolchain are excluded and its compiled bundle is added back below. Two of its
# directories LOOK like source and are deliberately NOT excluded, because the
# runtime reads them from disk — hatch/blocks-src/ supplies the block.json
# metadata hatch.php registers blocks from, and hatch/agent/ is the payload
# class-frontend-installer-route.php serves to the VPS installer. Dropping
# either produces a zip that activates cleanly and then misbehaves.
rsync -a \
    --exclude '/.git' \
    --exclude '/.github' \
    --exclude '/.gitignore' \
    --exclude '/.gitattributes' \
    --exclude '/.distignore' \
    --exclude '/.editorconfig' \
    --exclude '/.vscode' \
    --exclude '/.idea' \
    --exclude '/.claude' \
    --exclude '/.sandbox' \
    --exclude '/.mcp.json' \
    --exclude '/skills-lock.json' \
    --exclude '/scripts' \
    --exclude '/docs' \
    --exclude '/composer.json' \
    --exclude '/composer.lock' \
    --exclude '/dashboard' \
    --exclude '/new-dashboard' \
    --exclude '/vendor' \
    --exclude '/hatch/admin-react' \
    --exclude '/hatch/docs' \
    --exclude '/hatch/package.json' \
    --exclude '/hatch/package-lock.json' \
    --exclude '/hatch/tailwind.config.js' \
    --exclude '/hatch/wizard-screenshots.mjs' \
    --exclude '/hatch/.gitignore' \
    --exclude '/hatch/readme.txt' \
    --exclude '/hatch/CHANGELOG.md' \
    --exclude '/hatch/design.md' \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    --exclude '*.log' \
    --exclude '*.map' \
    "$ROOT/" "$STAGE/uichemy/"

# Add back only the compiled bundle.
mkdir -p "$STAGE/uichemy/new-dashboard"
rsync -a --exclude '*.map' "$ROOT/new-dashboard/build/" "$STAGE/uichemy/new-dashboard/build/"

( cd "$STAGE" && zip -qr "$OUT" ./uichemy )

# Guard the failure mode above: every PHP file the checkout ships must be in the
# archive. Anything listed here is a packaging bug, not a code change.
MISSING=$(
    comm -23 \
        <( cd "$ROOT" && find . -name '*.php' \
             -not -path './.git/*' -not -path './vendor/*' \
             -not -path './dashboard/*' -not -path './new-dashboard/*' \
             -not -path './scripts/*' -not -path '*/node_modules/*' \
             -not -path './.sandbox/*' \
             | sed 's|^\./||' | sort ) \
        <( unzip -Z1 "$OUT" | sed 's|^uichemy/||' | grep '\.php$' | sort )
)
if [ -n "$MISSING" ]; then
    echo "ERROR: these PHP files did not make it into the archive:" >&2
    echo "$MISSING" >&2
    exit 1
fi

# Guard the licence notices. Shipping third-party code without them is a
# distribution-licence problem, so treat an absent notice as a build failure
# rather than something to notice after release. `.sandbox` is checked here too:
# it holds reference material that must never reach an archive.
for required in \
    'uichemy/LICENSE' \
    'uichemy/THIRD-PARTY-LICENSES.txt' \
    'uichemy/hatch/hatch.php' \
    'uichemy/hatch/build/admin/index.jsx.js' \
    'uichemy/hatch/agent/agent.js' \
    'uichemy/vendor-prefixed/wordpress/mcp-adapter/LICENSE.md' \
    'uichemy/vendor-prefixed/wordpress/php-mcp-schema/LICENSE.md'
do
    if ! unzip -Z1 "$OUT" | grep -qxF "$required"; then
        echo "ERROR: $required is missing from the archive." >&2
        exit 1
    fi
done

if unzip -Z1 "$OUT" | grep -q '/\.sandbox/'; then
    echo "ERROR: .sandbox reference material leaked into the archive." >&2
    exit 1
fi

# Exactly ONE file in the archive may carry a `Plugin Name:` header.
#
# This guard exists because shipping a second one made the plugin impossible to
# activate. The installer picks the file to offer an "Activate" link for via
# Plugin_Upgrader::plugin_info() → get_plugins( '/uichemy' ), which — scoped to a
# folder — scans that folder's top level AND one subdirectory deep, then sorts by
# plugin name. A bundled runtime carrying its own header (hatch/hatch.php did)
# can therefore win the pick, and the link points at a path three levels below
# the plugins root. activate_plugin() validates against the UNSCOPED get_plugins(),
# which only ever scans two levels, so it fails with:
#
#     "The plugin does not have a valid header."
#
# WordPress reads only the first 8KB of a file for headers, so that is all this
# checks. Restricted to the two depths WordPress itself looks at.
HEADERS=$(
    cd "$STAGE/uichemy" && for f in ./*.php ./*/*.php; do
        [ -f "$f" ] || continue
        if head -c 8192 "$f" | grep -qiE '^[[:space:]*#@/]*Plugin Name:'; then
            echo "${f#./}"
        fi
    done
)
HEADER_COUNT=$(printf '%s' "$HEADERS" | grep -c . || true)
if [ "$HEADER_COUNT" -ne 1 ] || [ "$HEADERS" != "uichemy.php" ]; then
    echo "ERROR: the archive must contain exactly one plugin header, in uichemy.php." >&2
    echo "       Found: ${HEADERS:-<none>}" >&2
    echo "       A bundled runtime must not advertise itself as a plugin." >&2
    exit 1
fi

echo "built: $OUT"
unzip -l "$OUT" | tail -1
