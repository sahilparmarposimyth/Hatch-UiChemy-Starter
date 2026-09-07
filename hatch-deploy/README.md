# hatch-deploy — the deploy broker

The service behind the 1-click deploy. WordPress cannot clone a repo, run
`npm install` and build an Astro site, so this does it: the plugin hands it a
ticket, it clones the starter, builds, uploads to Vercel or Cloudflare, and hands
back the live URL.

Five files, `express` + `sharp`, tickets in memory, no database.

Public instance: `https://hatch.adityaarsharma.com`.

## Why you might self-host it

Per deploy, the plugin POSTs this service:

- `wp_url`, `wp_user`, `wp_pass` — a live **WordPress Application Password**
- `webhook_secret`
- the customer's **Vercel or Cloudflare API token**

Nothing is persisted — `server.js` holds tickets in a `Map` with a five-minute
TTL and makes no disk or database writes at all, which is what the build page
means by "your token lives in memory for the build duration only". But the data
still transits whoever runs the box. Shipping this inside a plugin at scale means
those are your customers' credentials on someone else's server, under someone
else's privacy policy. Running your own instance makes that yours.

It also puts the response headers under your control, which is what lets the
build page render inside the dashboard rather than taking over the tab.

## Requirements

| Need | Why |
|---|---|
| **Node ≥ 20** | `engines` in package.json |
| **git** | `git clone --depth 1 --branch $HATCH_BRANCH $HATCH_REPO` |
| **npm + registry access** | runs `npm install` and `npm run build` in `astro-starter/` per deploy |
| **`npx` able to fetch packages** | pulls `vercel` and `wrangler@latest` at deploy time — they are **not** dependencies |
| **CPU, RAM, disk** | a full install + Astro build per deploy, in `/tmp/hatch-<provider>-XXXXXX` |
| **HTTPS** | `/prepare` carries an Application Password and a cloud token |

That fourth row is the one that catches people: a box with no npm registry
egress clones and builds fine, then fails at upload.

## Run it

On a Debian/Ubuntu VPS, one command does everything except the parts only you
can do:

```bash
sudo bash deploy/install.sh
```

It checks Node ≥ 20, git, and — importantly — that the box can reach the npm
registry, because every deploy fetches `vercel` / `wrangler` through `npx`; a box
without that egress clones and builds fine, then fails at upload. Then it creates
a `hatch` service user, installs dependencies, writes a starter `.env` (mode 600,
never overwritten on re-run), installs a systemd unit, starts it and verifies
`/health` locally.

Re-running it upgrades the code and restarts the service. It deletes nothing.

It stops short of three things on purpose:

1. editing `.env` — `HATCH_DEPLOY_BASE` at minimum,
2. TLS — see `deploy/nginx.conf.example`, then `certbot --nginx -d your.domain`,
3. pointing WordPress at it.

**On a managed panel (RunCloud, Ploi, Forge), skip the nginx and systemd parts.**
Those panels generate and overwrite their own vhosts, so a hand-written one gets
clobbered. Create a Web Application for the domain and a supervisor job running
`npm start` in this directory as the service user, with `.env` loaded.

Manually, if you prefer:

```bash
cd hatch-deploy && npm ci --omit=dev && npm start   # = node server.js
```

### Railway / Render

Both work, because both give a long-running container with a shell. Deploy via
the **Dockerfile**, not the auto-detected Node buildpack: the broker needs `git`
present at *runtime* (it clones on every deploy) and buildpacks do not reliably
keep it in the runtime image. The Dockerfile makes it explicit and identical on
both platforms.

**Render** — `render.yaml` at the repo root is a ready blueprint
(*New → Blueprint*). Or by hand: New → Web Service, Docker runtime, **Root
Directory `hatch-deploy`**, health check `/health`.

**Railway** — New Project → Deploy from repo, set the service **Root Directory**
to `hatch-deploy` so it picks up this Dockerfile. Railway injects `PORT`, which
`server.js` already honours.

Either way, set:

| | |
|---|---|
| `HATCH_DEPLOY_BASE` | the URL the platform gives you, or your custom domain |
| `HATCH_REPO` / `HATCH_BRANCH` | starter source — the default is public |
| `HATCH_MAX_CONCURRENT_BUILDS` | **`1`** on a managed instance |

Three things that will bite on a managed platform:

- **Do not use the free/starter tier.** Every build is an `npm install` plus an
  `astro build` — about a gigabyte. 512 MB OOMs mid-deploy. Render *Standard* or
  the Railway equivalent is the floor, and set the concurrency to 1.
- **Keep egress to the npm registry.** `npx vercel` / `npx wrangler@latest` are
  fetched at deploy time, not baked into the image. A locked-down egress policy
  lets the clone and build succeed and then fails at upload.
- **Do not put it to sleep.** Free tiers idle containers out. Tickets live in
  process memory, so a sleep mid-deploy loses the build, and the plugin polls a
  ticket that no longer exists.

Serverless is not an option — see the note at the end of this file.

### Files

| | |
|---|---|
| `Dockerfile` | container image: Debian slim (glibc, for `sharp`), plus `git` |
| `../render.yaml` | Render blueprint — at the REPO ROOT, the only place Render reads one from |
| `deploy/install.sh` | the installer above |
| `deploy/hatch-deploy.service` | systemd unit — restart-always, `PrivateTmp`, `LimitCORE=0` so the in-memory credentials cannot reach a core dump |
| `deploy/nginx.conf.example` | reverse proxy, `proxy_buffering off` so the streaming build log is not held back |

## Configuration

All environment variables — nothing to edit in the source.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | what your proxy forwards to |
| `HATCH_DEPLOY_BASE` | `https://hatch.adityaarsharma.com` | this instance's own public URL |
| `HATCH_REPO` | `https://github.com/adityaarsharma/hatch.git` | repo the starter is cloned from |
| `HATCH_BRANCH` | `main` | branch to clone |
| `HATCH_MAX_CONCURRENT_BUILDS` | `3` | parallel builds; each is ~1 GB. Use `1` on a small instance |
| `ALLOWED_IMG_ORIGINS` | *(empty)* | comma-separated allowlist for the `GET /img` proxy. Empty proxies nothing — closed by default |
| `IMG_CACHE_MAX_BYTES` | `524288000` | image-cache ceiling, LRU-evicted. Lower it (e.g. `52428800`) on a container with modest ephemeral disk |
| `HATCH_ROOT_DIR` | `astro-starter` | **leave alone** — see below |

`HATCH_ROOT_DIR` does *not* set the build directory, despite the name. It is only
the `root-directory` value handed to Vercel's and Cloudflare's own import UIs on
the landing pages (`server.js` ~2261). The directory actually built is hardcoded
as `path.join( workDir, 'astro-starter' )` in both deploy libs, which ignores
this variable — so changing it desynchronises those links from the real build
without moving the build.

Example, pointing at the UiChemy starter mirror:

```bash
PORT=3000
HATCH_DEPLOY_BASE=https://deploy.example.com
HATCH_REPO=https://github.com/sahilparmarposimyth/Hatch-UiChemy-Starter.git
HATCH_BRANCH=main
```

That repo is a full copy of `eticastudio/hatch` (`main` + all tags), so it has
`astro-starter/` where the broker expects it. It keeps `upstream` pointed at the
original, so starter updates come down with:

```bash
git fetch upstream && git merge upstream/main
```

Then point the plugin at it, in `wp-config.php`:

```php
define( 'HATCH_DEPLOY_BROKER_URL', 'https://deploy.example.com' );
```

`Hatch_Deploy_Broker::base_url()` reads that constant and falls back to the
public instance, so this is the only plugin-side change.

## Two things that will bite

**`HATCH_REPO` must contain a top-level `astro-starter/`.** The broker clones,
then does `path.join( workDir, 'astro-starter' )`, writes `.env` there and builds
inside it. A repo without that directory clones successfully and fails at the
next step. Copy `astro-starter/` from this repo across unchanged.

**The clone is unauthenticated.** `runCmd('git', ['clone', …])` passes no
credentials, so an HTTPS `HATCH_REPO` must be publicly readable. The default
(`eticastudio/hatch`) is public, so it works out of the box.

A **private** `HATCH_REPO` needs the box to supply credentials. Two ways:

*Deploy key over SSH — keeps the source closed, nothing secret in the env:*

```bash
ssh-keygen -t ed25519 -f ~/.ssh/hatch_starter -N ''
# add ~/.ssh/hatch_starter.pub to the repo:
#   Settings → Deploy keys → Add deploy key (read access is enough)
cat >> ~/.ssh/config <<'CFG'
Host github-starter
  HostName github.com
  User git
  IdentityFile ~/.ssh/hatch_starter
  IdentitiesOnly yes
CFG
ssh -T github-starter          # accept the host key once, as the service user
```

```bash
HATCH_REPO=github-starter:sahilparmarposimyth/Hatch-UiChemy-Starter.git
```

The host key must already be in the service user's `known_hosts` — the clone
runs non-interactively and will hang or fail on the prompt otherwise.

*Or a read-only fine-grained token over HTTPS. Simpler to set up, but it is a
secret living in an env var, and it expires:*

```bash
HATCH_REPO=https://x-access-token:<TOKEN>@github.com/sahilparmarposimyth/Hatch-UiChemy-Starter.git
```

Get one at **GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**, then:

- **Resource owner** — the account that owns the repo
- **Repository access** — *Only select repositories* → the starter repo
- **Permissions** — *Repository permissions → Contents: Read-only*. That is the
  only scope a clone needs; anything more is a bigger blast radius for no gain
- **Expiration** — it will need rotating, so put a reminder somewhere

The value starts `github_pat_…` and is shown once.

> The clone URL is written into the build log, which is stored on the ticket,
> served by `/status` and rendered in the browser. A token embedded in
> `HATCH_REPO` used to be printed there in plaintext. `redactRepoUrl()` in both
> deploy libs now strips userinfo before logging, so it appears as
> `https://***@github.com/…`. If you are running an older broker, do not put a
> token in `HATCH_REPO` — use the deploy key instead.

Making the repo public also works, but publishes the whole plugin source — a
product decision, not a deployment one.

## Sanity check

```bash
curl https://deploy.example.com/health
```

Then run one real deploy and watch the log. A build is 60–90 seconds:
clone → npm install → astro build → upload.

## Routes

| Route | |
|---|---|
| `POST /deploy/<provider>/prepare` | takes credentials + token, issues a ticket |
| `GET /deploy/<provider>/start` | redirects to `/build` |
| `GET /deploy/<provider>/build` | starts the pipeline, renders the live log page |
| `GET /deploy/<provider>/status` | JSON: `{ stage, log[], error, project_url, return_url }` |
| `GET /install.sh` | the VPS installer |
| `GET /health` | liveness |

`stage` is one of `token_attached`, `building`, `complete`, `failed`. Providers
are `vercel`, `cloudflare`, `vps`.

`/status` is what makes the dashboard's inline deploy screen possible — it
returns the whole log, so the browser never has to visit this service. See
`includes/hatch/class-uich-hatch-deploy.php` in the merged UiChemy plugin.

## Why this cannot run on serverless

Not a configuration limit — the design is incompatible, in two ways that no plan
tier fixes.

**The build is deliberately detached from the response.** `makeBuildHandler`
starts the pipeline in an un-awaited async function and then answers immediately:

```js
(async () => { await cfg.runner(...) })();   // 60–90s of git + npm + astro
res.type('html').send(...)                   // returns at once
```

Serverless guarantees the opposite: once the response is sent the instance is
frozen or destroyed. The pipeline would die mid-`npm install` every time.

**Tickets live in process memory.** `const tickets = new Map()`. `/prepare`
writes one and `/build` and `/status` read it; across instances those are
different Maps, so `/build` reports "Ticket expired" for a ticket issued a second
earlier.

On top of that it needs `git`, `npm` and `npx` on PATH, a writable temp dir large
enough for a `node_modules` tree plus Astro output, and a concurrency counter
that means something — none of which survive a per-request runtime.

Making it serverless means moving tickets to Redis/KV and the build to a queued
container worker. At which point it is a container worker, so start with one.
