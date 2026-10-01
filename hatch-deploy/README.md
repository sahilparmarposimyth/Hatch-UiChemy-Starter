# hatch-deploy (deploy broker)

Builds the Astro starter for a WordPress site and ships it to Vercel or Cloudflare Workers.
The WordPress plugin calls `POST /deploy/<provider>/prepare` server to server, sends the
visitor's browser to `/start`, and the build streams a live log.

## What the broker holds, and for how long

| Secret | Kept | Dropped |
|---|---|---|
| Cloudflare / Vercel API token | in memory, for the build | the moment the build ends |
| WordPress Application Password (read-only service user `uichemy-deploy`) | in memory, for the build | the moment the build ends |
| Webhook secret | in memory, for the build | the moment the build ends |

Nothing sensitive reaches a log line, `/status`, or an error message (`makeRedactor`).
Build subprocesses get an allowlisted environment, not the broker's own (`buildEnv`), because
`npm install` runs third-party lifecycle scripts.

## When a build ends

The broker POSTs `{ ticket, status, provider, ts, sig }` to the site's
`/wp-json/hatch/v1/deploy/finished`, where `sig = HMAC-SHA256(webhook_secret,
"finished|<ticket>|<status>|<provider>|<ts>")`. The plugin keeps the credential on `success`
(the live site runs on it) and revokes it on `failed`, even if the visitor closed the tab.
The secret itself is never sent. WordPress refuses anything older than 5 minutes.

## `/prepare` validation

HTTPS only; `wp_url` must resolve to a public address (the build fetches it, so anything
else would be an SSRF); no control characters in any field; `return_url` must be HTTPS and
end in `/wp-admin/admin-post.php`; webhook secret 32+ characters; provider token
`[A-Za-z0-9_.:-]` only. Rate limited to 20 per 10 minutes per client, and at most 500 live
tickets.

## Environment

| Variable | Purpose |
|---|---|
| `PORT` | listen port (default 3000) |
| `HATCH_TRUST_PROXY=1` | set behind nginx/RunCloud so rate limiting keys on the real client IP |
| `HATCH_ALLOW_INSECURE=1` | **local development only**: allows `http://` and private addresses |
| `HATCH_REPO`, `HATCH_BRANCH` | what gets built. Pin `HATCH_BRANCH` to a release tag in production |
| `HATCH_VERCEL_CLI_VERSION`, `HATCH_WRANGLER_VERSION` | pin the CLIs (default `latest`) |
| `HATCH_DEPLOY_BASE` | public URL of this broker |

## Limits that cannot be fixed here

The broker cannot inspect the scope of a Cloudflare/Vercel token, so it cannot refuse an
over-broad one. The setup wizard tells the visitor which minimal token to create.
