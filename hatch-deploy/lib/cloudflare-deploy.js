/**
 * Cloudflare Workers — Direct Deploy pipeline (v0.20.0).
 *
 * Same shape as vercel-deploy.js. User pastes a CF API token in the Hatch WP
 * plugin's Cloudflare card. Broker runs server-side (no GitHub fork on user's
 * account):
 *   1. Verify the token against CF API + grab the account ID
 *   2. git clone adityaarsharma/hatch (depth 1)
 *   3. write astro-starter/.env with WP credentials so the build embeds them
 *   4. npm install
 *   5. HATCH_TARGET=cf CF_PAGES=1 npm run build  →  dist/_worker.js/...
 *   6. echo "_worker.js" > dist/.assetsignore   ← so wrangler skips the Worker
 *      code from the Assets upload (it's the Worker, not an asset)
 *   7. npx wrangler@latest deploy --name <project-name>
 *      via env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *   8. Parse the *.workers.dev URL from CLI output
 *   9. Clean up temp dir, drop token from memory
 *
 * Notes
 *   - imageService is set to 'passthrough' on the CF target in astro.config.mjs,
 *     because 'compile' still pulls sharp's IIFE into the Worker bundle, which
 *     fails the validator (process.report.getReport not in CF Workers runtime).
 *   - Project names derive from the WP hostname + a 4-char random suffix so
 *     multiple Hatch sites on the same CF account don't collide.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { imgAllowedHosts } from './img-hosts.js';

/*
 * Each concurrent build is its own `npm install` + `astro build`, which is
 * roughly a gigabyte of RAM and a node_modules tree on disk. Three is right for
 * a 4 GB VPS and will OOM a 512 MB container, so it is settable — a small
 * managed instance should run 1.
 */
const MAX_CONCURRENT_BUILDS = Math.max(
	1,
	parseInt(process.env.HATCH_MAX_CONCURRENT_BUILDS || '3', 10) || 3
);
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/*
 * How many times to try the clone before giving up.
 *
 * A real deploy failed with `Failed to connect to github.com port 443 after
 * 134096 ms` — DNS resolved, the TCP connect simply never completed — on a run
 * whose predecessor had cloned the same repo without trouble. Flaky egress, not
 * misconfiguration, and with one attempt every deploy is a coin toss.
 */
const CLONE_ATTEMPTS = 3;

/*
 * Cap on ONE clone attempt. Generous for a 32 MB shallow clone on a slow box,
 * short enough that three attempts plus backoff still leave most of
 * BUILD_TIMEOUT_MS for the install and the Astro build.
 */
const CLONE_TIMEOUT_MS = 90 * 1000;
const HATCH_REPO = process.env.HATCH_REPO || 'https://github.com/adityaarsharma/hatch.git';
const HATCH_BRANCH = process.env.HATCH_BRANCH || 'main';

/**
 * A repo URL that is safe to put in the build log.
 *
 * The clone URL is echoed into progress output, and that output is stored on the
 * ticket, served by /status and rendered in the browser. A private HATCH_REPO is
 * commonly authenticated by embedding credentials in the URL
 * (`https://x-access-token:<token>@github.com/…`), which would therefore print
 * the token in plaintext to anyone watching the build — including through the
 * status API.
 *
 * Strips userinfo and leaves a marker so it is obvious credentials were used.
 * scp-style SSH remotes (`git@github.com:owner/repo.git`) are not valid URLs and
 * throw here; they carry no secret, so they pass through untouched.
 *
 * @param {string} u Repo URL, possibly containing credentials.
 * @returns {string} The same URL with any username/password removed.
 */
function redactRepoUrl(u) {
	try {
		const url = new URL(String(u));
		if (!url.username && !url.password) return String(u);
		url.username = '';
		url.password = '';
		return url.toString().replace('://', '://***@');
	} catch {
		return String(u);
	}
}

let activeBuilds = 0;
const buildQueue = [];

function acquireSlot() {
	return new Promise((resolve) => {
		if (activeBuilds < MAX_CONCURRENT_BUILDS) {
			activeBuilds++;
			resolve();
		} else {
			buildQueue.push(resolve);
		}
	});
}
function releaseSlot() {
	activeBuilds--;
	const next = buildQueue.shift();
	if (next) { activeBuilds++; next(); }
}

function runCmd(cmd, args, opts = {}) {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd: opts.cwd,
			env: { ...process.env, ...(opts.env || {}) },
		});
		let stdout = '';
		let stderr = '';
		const onLine = (chunk, isErr) => {
			const text = chunk.toString();
			if (isErr) stderr += text; else stdout += text;
			if (opts.onProgress) {
				for (const line of text.split('\n')) {
					if (line.trim()) opts.onProgress(line.trim());
				}
			}
		};
		proc.stdout.on('data', (c) => onLine(c, false));
		proc.stderr.on('data', (c) => onLine(c, true));
		/*
		 * Per-command cap, defaulting to the whole-build one. The clone needs its
		 * own: git exposes no connect timeout, so a blackholed TCP connect to
		 * github.com sat for 134 SECONDS on a real deploy before curl gave up.
		 * Under the 10-minute default, three retries of that would eat most of
		 * the build budget and still be waiting.
		 */
		const limitMs = opts.timeoutMs || BUILD_TIMEOUT_MS;
		const killer = setTimeout(() => {
			proc.kill('SIGKILL');
			reject(new Error(`Timeout after ${limitMs / 1000}s: ${cmd} ${args.join(' ')}`));
		}, limitMs);
		proc.on('close', (code) => {
			clearTimeout(killer);
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${stderr.slice(-2000)}`));
		});
		proc.on('error', (err) => { clearTimeout(killer); reject(err); });
	});
}

/**
 * Verify the CF token has Workers deploy access by listing accounts.
 * Returns the first account ID (used as CLOUDFLARE_ACCOUNT_ID for wrangler).
 *
 * We don't use /user/tokens/verify because that endpoint requires "User Tokens:
 * Read" permission, which deploy-only tokens don't include. /accounts works
 * with any token that has account-level access — which deploy tokens do.
 */
async function verifyCloudflareToken(token) {
	const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
		headers: { 'Authorization': `Bearer ${token}` },
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Cloudflare rejected the token: ${body.slice(0, 400)}`);
	}
	const data = await res.json();
	const accountId = data?.result?.[0]?.id;
	if (!accountId) {
		throw new Error('Token authenticated but no Cloudflare account visible to it.');
	}
	return { accountId, accountName: data.result[0].name || '' };
}

function deriveProjectName(wpUrl) {
	let slug = 'hatch-frontend';
	try {
		const host = new URL(wpUrl).hostname.replace(/^www\./, '');
		slug = host
			.replace(/\./g, '-')
			.replace(/[^a-z0-9-]/gi, '')
			.toLowerCase()
			.slice(0, 40)
			.replace(/-+$/, '');
		if (!slug) slug = 'hatch-frontend';
	} catch { /* keep default */ }
	const suffix = Math.random().toString(36).slice(2, 6);
	return `${slug}-${suffix}`;
}

/**
 * Full pipeline: clone → install → build → wrangler deploy → cleanup.
 *
 * @param {object} params
 * @param {object} params.ticket — wp_url, wp_user, wp_pass, webhook_secret
 * @param {string} params.cfToken — Cloudflare API token (cfat_* or legacy)
 * @param {function(string): void} params.onProgress
 * @returns {Promise<{project_url: string, project_name: string}>}
 */
export async function deployToCloudflare({ ticket, cfToken, onProgress }) {
	await acquireSlot();
	const progress = (msg) => { if (onProgress) onProgress(msg); };

	let workDir = null;
	try {
		progress('🔐 Verifying Cloudflare token…');
		const { accountId, accountName } = await verifyCloudflareToken(cfToken);
		progress(`✓ Token valid · account ${accountName || accountId.slice(0, 8) + '…'}`);

		progress('📁 Setting up build directory…');
		workDir = await mkdtemp(path.join(tmpdir(), 'hatch-cf-'));

		progress(`🐙 Cloning ${redactRepoUrl(HATCH_REPO)} (branch ${HATCH_BRANCH})…`);
		/*
		 * Two different stalls, two different guards. http.lowSpeedLimit/Time
		 * covers a transfer that starts and then crawls — git aborts once it sits
		 * under 1 KB/s for 30s. It does NOT cover a connect that never completes,
		 * which is the failure actually seen, because git exposes no connect
		 * timeout at all. That is what timeoutMs is for.
		 *
		 * workDir is recreated between attempts: git leaves a partial tree behind
		 * often enough, and `git clone` into a non-empty directory fails outright,
		 * which would turn one flaky attempt into a guaranteed failure.
		 */
		for (let attempt = 1; ; attempt++) {
			try {
				await runCmd('git', [
					'-c', 'http.lowSpeedLimit=1000',
					'-c', 'http.lowSpeedTime=30',
					'clone', '--depth', '1', '--single-branch',
					'--branch', HATCH_BRANCH, HATCH_REPO, workDir,
				], { onProgress: progress, timeoutMs: CLONE_TIMEOUT_MS });
				break;
			} catch (err) {
				if (attempt >= CLONE_ATTEMPTS) throw err;
				progress(`⚠️  Clone attempt ${attempt} of ${CLONE_ATTEMPTS} failed, retrying…`);
				await rm(workDir, { recursive: true, force: true });
				await mkdir(workDir, { recursive: true });
				await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
			}
		}

		const astroDir = path.join(workDir, 'astro-starter');

		progress('✍️  Writing astro-starter/.env (mode 600)…');
		const envContent = [
			`WP_API_URL=${ticket.wp_url}/wp-json/wp/v2`,
			`WP_API_USER=${ticket.wp_user}`,
			`WP_API_PASS=${ticket.wp_pass}`,
			`HATCH_WEBHOOK_SECRET=${ticket.webhook_secret}`,
			`PUBLIC_SITE_URL=https://placeholder.workers.dev`,
			// Hosts the deployed frontend's /img proxy may fetch from. Build-time
			// only: PUBLIC_ is Vite's envPrefix, so this is inlined into the bundle
			// and cannot be changed on the host afterwards. Empty here is what made
			// every template-CDN image 400 with "url host not allowed".
			`PUBLIC_IMG_ALLOWED_HOSTS=${imgAllowedHosts(ticket)}`,
			``,
		].join('\n');
		await writeFile(path.join(astroDir, '.env'), envContent);
		await chmod(path.join(astroDir, '.env'), 0o600);

		progress('📦 Installing dependencies (npm install)…');
		/*
		 * Retries matter more here than they look. A cold container has no npm
		 * cache, so this pulls the whole Astro dependency tree over the network on
		 * every deploy, and a single reset kills the build — the first real deploy
		 * on Render died with `npm error code ECONNRESET / network aborted` partway
		 * through. npm defaults to 2 retries with a short ceiling, which is not
		 * enough on a small managed instance.
		 *
		 * --prefer-offline is dropped: there is no cache to prefer in a fresh
		 * container, and it only obscures what the install is actually doing.
		 */
		await runCmd('npm', [
			'install',
			'--no-audit',
			'--no-fund',
			'--fetch-retries=5',
			'--fetch-retry-mintimeout=20000',
			'--fetch-retry-maxtimeout=120000',
			'--fetch-timeout=600000',
		], { cwd: astroDir, onProgress: progress });

		progress('🏗️  Building Astro (HATCH_TARGET=cf)…');
		// v0.49.2 — pass WP creds in subprocess env so Vite's `define` block
		// can read them via process.env and inline literal values into the
		// worker bundle. Without this, import.meta.env.WP_API_URL is undefined
		// at runtime in Workers and the frontend silently falls back to "Hatch"
		// defaults — i.e. empty posts/comments on the live site.
		await runCmd('npm', ['run', 'build'], {
			cwd: astroDir,
			env: {
				HATCH_TARGET:          'cf',
				CF_PAGES:              '1',
				WP_API_URL:            `${ticket.wp_url}/wp-json/wp/v2`,
				WP_API_USER:           ticket.wp_user,
				WP_API_PASS:           ticket.wp_pass,
				HATCH_WEBHOOK_SECRET:  ticket.webhook_secret,
				PUBLIC_IMG_ALLOWED_HOSTS: imgAllowedHosts(ticket),
			},
			onProgress: progress,
		});

		// Add .assetsignore so wrangler skips the _worker.js dir from the
		// Assets upload — it's the Worker code, not a static asset.
		const distDir = path.join(astroDir, 'dist');
		await writeFile(path.join(distDir, '.assetsignore'), '_worker.js\n');

		const projectName = deriveProjectName(ticket.wp_url);
		progress(`🚀 Deploying to Cloudflare Workers as "${projectName}"…`);

		const deployRes = await runCmd('npx', [
			'--yes',
			'wrangler@latest',
			'deploy',
			'--name', projectName,
		], {
			cwd: astroDir,
			env: {
				CLOUDFLARE_API_TOKEN: cfToken,
				CLOUDFLARE_ACCOUNT_ID: accountId,
			},
			onProgress: progress,
		});

		// Parse the deployment URL from wrangler output. Wrangler prints:
		//   "Deployed <name> triggers (X.Y sec)"
		//   "  https://<name>.<user>.workers.dev"
		// Capture the last workers.dev URL in the output.
		const combinedOutput = (deployRes.stdout + '\n' + deployRes.stderr);
		const urlMatches = [...combinedOutput.matchAll(/https:\/\/[\w.-]+\.workers\.dev/g)].map((m) => m[0]);
		const projectUrl = urlMatches[urlMatches.length - 1] || null;
		if (!projectUrl) {
			throw new Error('Deployed but could not parse the *.workers.dev URL from CLI output.');
		}

		progress(`✨ Done — your site is live at ${projectUrl}`);
		return { project_url: projectUrl, project_name: projectName };
	} finally {
		if (workDir) {
			try { await rm(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
		}
		releaseSlot();
	}
}
