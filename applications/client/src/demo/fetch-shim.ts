/**
 * Answers the handful of REST calls the client makes to the RedEye server (login, metadata, uploads)
 * so the app can run as a static site. Everything else passes through to the real fetch.
 */
import { db } from './db';
import { executeDemoQuery } from './executor';
import { uuid } from './resolvers';
import { seedFileSizes, seeds, uploadSeedId } from './seeds';
import { demoSettings } from './settings';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fileNames = (body: BodyInit | null | undefined): string[] => {
	if (!(body instanceof FormData)) return [];
	const names: string[] = [];
	body.forEach((value, key) => {
		if (typeof value !== 'string') names.push((value as File).name || key);
		else if (key === 'file' || key === 'files') names.push(value);
	});
	return names;
};

async function handle(path: string, init: RequestInit | undefined): Promise<Response | undefined> {
	const method = (init?.method ?? 'GET').toUpperCase();

	if (path === '/api/appMetadata') return json({ blueTeam: demoSettings.blueTeam });
	if (path === '/api/login') return json({ auth: true });
	if (path === '/api/loginStatus') return json({ auth: true });
	if (path === '/api/logout') return json({ auth: false });

	if (path === '/api/graphql' && method === 'POST') {
		const { query, variables } = JSON.parse(String(init?.body ?? '{}'));
		return json({ data: await executeDemoQuery(query, variables) });
	}

	// Parser upload: accept every file and group them into servers by folder
	const validate = path.match(/^\/api\/parser\/[^/]+\/validate-files$/);
	if (validate) {
		const paths = fileNames(init?.body).map((name) => name.replace(/:/g, '/'));
		const servers = new Map<string, number>();
		for (const filePath of paths) {
			const segments = filePath.split('/').filter(Boolean);
			// a server folder holds dated (YYMMDD) folders of beacon logs
			const dated = segments.findIndex((segment) => /^\d{6}$/.test(segment));
			const server = dated > 0 ? segments[dated - 1] : segments[segments.length > 2 ? 1 : 0] ?? 'Server';
			servers.set(server, (servers.get(server) ?? 0) + 1);
		}
		if (!servers.size) servers.set('Demo-Server', 1);
		return json({
			valid: paths,
			invalid: [],
			servers: Array.from(servers, ([name, fileCount]) => ({ name, fileCount })),
		});
	}

	// Parser upload of a new campaign: createCampaign already gave it demo data
	if (/^\/api\/campaign\/[^/]+\/upload$/.test(path)) return json({ ok: true });

	// Upload of an existing .redeye database: pick the bundled dataset with the same file name, if any
	if (path === '/api/campaign/upload') {
		const body = init?.body instanceof FormData ? init.body : undefined;
		const name = String(body?.get('name') ?? 'Uploaded Campaign');
		const file = body?.get('file');
		const fileName = file instanceof File ? file.name : '';
		const seedId =
			(file instanceof File && seedFileSizes[file.size]) ||
			Object.keys(seeds).find((id) => fileName && fileName.includes(id)) ||
			uploadSeedId;
		const user = localStorage.getItem('user') || 'demo';
		db.ensureGlobalOperator(user);
		db.addCampaign({ id: uuid(), name, seedId, creatorId: user, lastOpenedById: user, parserName: 'redeye-database' });
		return json({ ok: true });
	}

	// Export of an anonymized campaign: hand back the demo campaign as JSON
	const download = path.match(/^\/api\/campaign\/download\/(.+)$/);
	if (download) {
		const campaignId = decodeURIComponent(download[1]);
		const campaign = db.campaign(campaignId);
		const blob = new Blob([JSON.stringify({ campaign, ...db.project(campaignId) }, null, 2)], {
			type: 'application/json',
		});
		return new Response(blob, {
			status: 200,
			headers: { 'Content-Disposition': `attachment; filename="${campaign.name}.json"` },
		});
	}

	return undefined;
}

export function installFetchShim() {
	const realFetch = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const apiIndex = url.indexOf('/api/');
		if (apiIndex !== -1) {
			const path = url.slice(apiIndex).split('?')[0];
			try {
				const response = await handle(path, init);
				if (response) return response;
			} catch (e) {
				return new Response((e as Error).message, { status: 500 });
			}
			// eslint-disable-next-line no-console
			console.warn('RedEye demo: unhandled API call', method(init), path);
			return json({ error: 'Not available in the demo' }, 404);
		}
		return realFetch(input, init);
	};
}

const method = (init?: RequestInit) => (init?.method ?? 'GET').toUpperCase();
