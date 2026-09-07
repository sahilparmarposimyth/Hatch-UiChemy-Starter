/**
 * Vercel — Direct Upload pipeline (v0.20.0).
 *
 * Run server-side when a user pastes a Vercel access token in the Hatch WP
 * plugin wizard's Vercel card. We:
 *   1. Verify the token against the Vercel API
 *   2. git clone adityaarsharma/hatch (depth 1, no fork on user's GitHub)
 *   3. write astro-starter/.env with the user's WP credentials so Astro's
 *      build embeds them into the SSR bundle
 *   4. npm install
 *   5. HATCH_TARGET=vercel npm run build → .vercel/output/
 *   6. npx vercel deploy --prebuilt --prod --token=$TOKEN --yes  (no GitHub
 *      involvement, no project link prompt, no fork)
 *   7. Parse the production URL from CLI output
 *   8. Clean up temp dir
 *
 * Result: user's *.vercel.app URL, deployed direct from broker. Token never
 * touches disk on the broker — passed via env var to the vercel CLI and
 * dropped from memory when this function returns.
 *
 * Same concurrency + timeout discipline as the CF pipeline:
 *   - 3 simultaneous builds max (~1GB RAM each, broker has 16GB)
 *   - 10 min hard cap per build
 *   - /tmp/hatch-vercel-* dir cleaned up regardless of success/failure
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
	if (next) {
		activeBuilds++;
		next();
	}
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
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${stderr.slice(-2000)}`));
			}
		});
		proc.on('error', (err) => {
			clearTimeout(killer);
			reject(err);
		});
	});
}

async function verifyVercelToken(token) {
	const res = await fetch('https://api.vercel.com/v2/user', {
		headers: { 'Authorization': `Bearer ${token}` },
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Vercel rejected the token: ${body.slice(0, 400)}`);
	}
	const data = await res.json();
	return data.user;
}

/**
 * Full pipeline: clone → install → build → vercel deploy → cleanup.
 *
 * @param {object} params
 * @param {object} params.ticket — wp_url, wp_user, wp_pass, webhook_secret
 * @param {string} params.vercelToken — Vercel access token (vcp_* or legacy format)
 * @param {function(string): void} params.onProgress — called per progress line
 * @returns {Promise<{project_url: string, project_name: string}>}
 */
export async function deployToVercel({ ticket, vercelToken, onProgress }) {
	await acquireSlot();

	const progress = (msg) => { if (onProgress) onProgress(msg); };

	let workDir = null;
	try {
		progress('🔐 Verifying Vercel token…');
		const user = await verifyVercelToken(vercelToken);
		progress(`✓ Token valid · user ${user.username || user.email}`);

		progress('📁 Setting up build directory…');
		workDir = await mkdtemp(path.join(tmpdir(), 'hatch-vercel-'));

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
			`PUBLIC_SITE_URL=https://placeholder.vercel.app`,
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

		progress('🏗️  Building Astro (HATCH_TARGET=vercel)…');
		// v0.49.2 — pass WP creds in subprocess env so Vite's `define` block
		// can inline literal values into the bundle. Without this, the
		// frontend silently falls back to defaults — empty posts/comments.
		await runCmd('npm', ['run', 'build'], {
			cwd: astroDir,
			env: {
				HATCH_TARGET:          'vercel',
				VERCEL:                '1',
				WP_API_URL:            `${ticket.wp_url}/wp-json/wp/v2`,
				WP_API_USER:           ticket.wp_user,
				WP_API_PASS:           ticket.wp_pass,
				HATCH_WEBHOOK_SECRET:  ticket.webhook_secret,
				PUBLIC_IMG_ALLOWED_HOSTS: imgAllowedHosts(ticket),
			},
			onProgress: progress,
		});

		progress('🚀 Deploying to Vercel (prebuilt, no GitHub fork)…');
		// vercel CLI uses VERCEL_TOKEN env var when present, OR --token flag.
		// We pass via env so the token never appears in process arg list.
		const deployRes = await runCmd('npx', [
			'--yes',
			'vercel@latest',
			'deploy',
			'--prebuilt',
			'--prod',
			'--yes',
		], {
			cwd: astroDir,
			env: { VERCEL_TOKEN: vercelToken },
			onProgress: progress,
		});

		// Parse the production URL from vercel CLI output. The CLI prints
		// lines like:
		//   🔍  Inspect: https://vercel.com/team/project/<deployment-hash>
		//   ✅  Production: https://your-project.vercel.app
		// The Production URL is the user-facing one. Take the last *.vercel.app
		// match (deduplicated, ignoring vercel.com inspect URLs).
		const combinedOutput = (deployRes.stdout + '\n' + deployRes.stderr);
		const urlMatches = [...combinedOutput.matchAll(/https:\/\/[\w-]+\.vercel\.app/g)].map((m) => m[0]);
		const uniqueUrls = [...new Set(urlMatches)];
		const projectUrl = uniqueUrls[uniqueUrls.length - 1] || null;
		if (!projectUrl) {
			throw new Error('Deployed but could not parse the *.vercel.app URL from CLI output. Check broker logs.');
		}

		// Derive project name from the URL subdomain.
		let projectName = 'hatch-frontend';
		try {
			const host = new URL(projectUrl).hostname;
			projectName = host.split('.')[0] || projectName;
		} catch { /* default */ }

		progress(`✨ Done — your site is live at ${projectUrl}`);
		return { project_url: projectUrl, project_name: projectName };
	} finally {
		if (workDir) {
			try { await rm(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
		}
		releaseSlot();
	}
}
