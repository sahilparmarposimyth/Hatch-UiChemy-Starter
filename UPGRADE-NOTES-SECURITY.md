# Upgrade notes: security release (starter, agent, broker)

Companion to the plugin's `UPGRADE-NOTES-ASTRO-SECURITY.md`. Covers `astro-starter/`, `nextjs-starter/`,
`wp-plugin/agent/` and `hatch-deploy/`.

## What you must do

| Who | Action |
|---|---|
| Sites running the **Astro starter** | Redeploy. The starter now authenticates to WordPress with a Bearer header, reads the revalidation secret from `X-Hatch-Secret` only, supports password-protected posts at `/unlock`, and renews sessions automatically. |
| Sites running the **Next.js starter** | Redeploy. Only the revalidation endpoint changed: it reads `X-Hatch-Secret` only (no `?secret=`). |
| Anyone with a **VPS agent** | Re-run the install one-liner. The agent is now HTTPS with a certificate generated at install and signs every response. Then click **Verify connection** in WordPress to pin the certificate. If you ever replace the certificate, verify again. |
| **Broker operators** | See `hatch-deploy/README.md`. In production set `HATCH_TRUST_PROXY=1`, pin `HATCH_BRANCH` to a release tag, and pin `HATCH_VERCEL_CLI_VERSION` and `HATCH_WRANGLER_VERSION`. The broker logs a warning at boot for each one that is missing. |

## Starter behaviour changes

- Login/register/logout proxies relay **only** the `hatch_jwt` cookie (HttpOnly, `Secure` on HTTPS, bound to your
  origin). The raw token is removed from the JSON the browser sees. WordPress's own login cookies are never relayed
  and never forwarded back.
- Server-side calls to WordPress carry `Authorization: Bearer <jwt>`. The Woo guest-cart cookies still flow both ways.
- Administrator accounts cannot sign in through the site (403 with a plain-language message); use wp-admin.
- `/api/hatch/*` exposes only `GET order/<id>` (what the order summary page needs), not the whole `/hatch/v1/` surface.
- Client IPs are taken from the adapter's own address and forwarded as `CF-Connecting-IP` / `X-Forwarded-For`, so
  WordPress rate-limits per visitor (once the site owner enables `hatch_trust_cf_ip`).
- Sessions last 24 hours and slide: on a page view in the last ~2 hours the token is renewed. Several tabs refreshing
  together share one call; the plugin keeps the old token alive for 30 seconds.
- Password-protected posts redirect to `/unlock`; a correct password sets a per-post HttpOnly cookie.

## Agent

`wp-plugin/agent/agent.js` v0.2.0: HTTPS only (refuses to start without a certificate unless
`allow_insecure_http` is set for local development), HMAC-signed responses including errors, signature formula
`HMAC-SHA256(secret, "<ts>.<nonce>.<body>")`. `install-template.sh` receives every value base64-encoded, validates
it, writes its config with node (no shell heredoc), and generates the certificate once so the pin stays valid.

## Tests

```
node tests/unit/agent-installer.test.mjs
node tests/unit/broker-security.test.mjs
node --experimental-strip-types tests/unit/wp-auth.test.mts
node --experimental-strip-types tests/unit/unlock.test.mts
node --experimental-strip-types tests/unit/refresh.test.mts
```

## Known limits

- A Cloudflare/Vercel token's scope cannot be inspected by the broker; the wizard tells the user what to create.
- Verified by unit tests and local runs, not against a live Vercel/Cloudflare account or a live WordPress site.
