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

```bash
cd hatch-deploy
npm install
npm start          # = node server.js
```

Put nginx (or RunCloud's vhost) in front of `PORT` with a certificate, and keep
the process up with a supervisor.

## Configuration

All environment variables — nothing to edit in the source.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | what your proxy forwards to |
| `HATCH_DEPLOY_BASE` | `https://hatch.adityaarsharma.com` | this instance's own public URL |
| `HATCH_REPO` | `https://github.com/adityaarsharma/hatch.git` | repo the starter is cloned from |
| `HATCH_BRANCH` | `main` | branch to clone |
| `HATCH_ROOT_DIR` | — | build scratch directory |

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

*Or a read-only fine-grained token over HTTPS — simpler, but it is a secret in
an env var and it expires:*

```bash
HATCH_REPO=https://x-access-token:<TOKEN>@github.com/sahilparmarposimyth/Hatch-UiChemy-Starter.git
```

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
