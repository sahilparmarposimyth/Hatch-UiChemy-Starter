# Hatch deploy broker — buildable from the REPOSITORY ROOT.
#
# This exists so `New → Web Service` works with Render's defaults. That flow
# ignores render.yaml completely and looks for `./Dockerfile` in the repo root,
# which is how the first deploy failed with
#
#     failed to read dockerfile: open Dockerfile: no such file or directory
#
# The broker's sources live in hatch-deploy/, so every COPY below is prefixed.
# hatch-deploy/Dockerfile is the same image built with that directory AS the
# context — keep the two in step if you change either.
#
# Node 22, not 20: the Astro starter this builds depends on astro ^7, which
# declares `node: >=22.12.0`. On 20 every dependency install printed EBADENGINE
# and the build ran on an engine none of them support. sharp is N-API so it is
# unaffected by the bump; 24 is avoided only because sharp 0.33 predates it.
#
# Debian slim, not Alpine: `sharp` ships prebuilt glibc binaries, and on musl it
# compiles from source, which turns a 20-second image build into a long one for
# no gain.
FROM node:22-slim

# The broker is a build machine. It shells out at DEPLOY time, so these are
# runtime dependencies, not build ones:
#   git             — clones the Astro starter for every deploy
#   ca-certificates — HTTPS to GitHub, npm, and the Vercel/Cloudflare APIs
# It also runs `npx vercel` / `npx wrangler@latest`, which are deliberately not
# pinned in package.json and are fetched on first use — so the running container
# needs npm-registry egress, not just the image build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code-only change reuses this layer.
# `npm install`, not `npm ci`: this package ships no lockfile.
COPY hatch-deploy/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Only the broker, not the monorepo. The root .dockerignore keeps the build
# context down to hatch-deploy/ as well, so the 32 MB of starter, docs and
# tests never reach the daemon.
COPY hatch-deploy/ ./

# Run unprivileged. `node` already exists in this image with a home directory,
# which npx needs somewhere writable to cache into.
ENV HOME=/home/node \
    NPM_CONFIG_CACHE=/home/node/.npm \
    NODE_ENV=production
RUN mkdir -p /home/node/.npm && chown -R node:node /home/node /app
USER node

# Informational only — the platform injects the real PORT and server.js honours
# it. Express binds 0.0.0.0 when no host is given, which is what a container
# needs.
EXPOSE 3000

# Builds stage under the system temp dir and are rm -rf'd in a finally, so the
# container needs no volume.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
