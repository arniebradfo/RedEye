/**
 * In-memory stand-in for the RedEye server's databases.
 *
 * Each campaign points at a read-only seed dataset. Large immutable tables (logs, commands, images, files)
 * are always read from the seed. Everything a user can edit is cloned per campaign and saved to
 * sessionStorage, so demo edits survive a reload but disappear with the tab.
 */
import { seeds, defaultCampaigns } from './seeds';

export type NodeColor = string | null | undefined;

export type ServerRow = {
	id: string;
	name: string;
	displayName?: string | null;
	hidden: boolean;
	meta: { id: string; type: string; shape: string; color?: NodeColor };
};

export type HostRow = {
	id: string;
	hostName: string;
	displayName?: string | null;
	hidden: boolean;
	cobaltStrikeServer: boolean;
	meta: {
		id: string;
		os?: string | null;
		osVersion?: string | null;
		ip?: string | null;
		type?: string | null;
		shape: string;
		color?: NodeColor;
	}[];
};

export type BeaconMetaRow = {
	id: string;
	pid?: number | null;
	process?: string | null;
	username?: string | null;
	startTime?: string | null;
	endTime?: string | null;
	ip?: string | null;
	port?: number | null;
	type?: string | null;
	shape: string;
	color?: NodeColor;
	sourceId?: string | null;
};

export type BeaconRow = {
	id: string;
	beaconName: string;
	displayName?: string | null;
	hidden: boolean;
	hostId: string;
	serverId: string;
	operatorIds: string[];
	meta: BeaconMetaRow[];
};

export type LogRow = {
	id: string;
	blob: string;
	filepath?: string | null;
	lineNumber: number;
	lineType?: string | null;
	logType: string;
	dateTime?: string | null;
	beaconId?: string | null;
	commandId?: string | null;
};

export type CommandRow = {
	id: string;
	commandFailed: boolean;
	attackIds: string[];
	inputId: string;
	inputText: string;
	beaconId: string;
	operatorId?: string | null;
};

export type CommandGroupRow = { id: string; generation: string; commandIds: string[] };

export type AnnotationRow = {
	id: string;
	text: string;
	generation: string;
	date: string;
	user: string;
	favorite: boolean;
	commandGroupId?: string | null;
	tagIds: string[];
};

export type TagRow = { id: string; text: string };

export type LinkRow = {
	id: string;
	name?: string | null;
	startTime?: string | null;
	endTime?: string | null;
	manual: boolean;
	originId?: string | null;
	destinationId?: string | null;
	commandId?: string | null;
};

export type OperatorRow = { id: string; startTime?: string | null; endTime?: string | null };
export type ImageRow = { id: string; fileType: string; beaconId?: string | null; url: string };
export type FileRow = {
	id: string;
	fileName: string;
	location: string;
	dateTime: string;
	md5?: string | null;
	fileFlag: string;
	beaconId?: string | null;
};

export type Seed = {
	servers: ServerRow[];
	hosts: HostRow[];
	beacons: BeaconRow[];
	logs: LogRow[];
	commands: CommandRow[];
	commandGroups: CommandGroupRow[];
	annotations: AnnotationRow[];
	tags: TagRow[];
	links: LinkRow[];
	operators: OperatorRow[];
	images: ImageRow[];
	files: FileRow[];
};

const immutableTables = ['logs', 'commands', 'images', 'files'] as const;
type ImmutableTable = (typeof immutableTables)[number];
export type MutableProject = Omit<Seed, ImmutableTable>;

export type CampaignRow = {
	id: string;
	name: string;
	seedId: string;
	creatorId?: string | null;
	lastOpenedById?: string | null;
	parserName: string;
};

type PersistedState = {
	version: number;
	campaigns: CampaignRow[];
	globalOperators: string[];
	projects: Record<string, MutableProject>;
};

const STORAGE_KEY = 'redeye-demo-state';
const STATE_VERSION = 1;

const storage = (() => {
	try {
		return window.sessionStorage;
	} catch {
		return undefined;
	}
})();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const mutableFromSeed = (seed: Seed): MutableProject => {
	const { logs, commands, images, files, ...rest } = seed;
	return clone(rest);
};

/** Cached lookups for one campaign. Rebuilt lazily after every mutation. */
export class ProjectIndex {
	beaconById = new Map<string, BeaconRow>();
	hostById = new Map<string, HostRow>();
	serverById = new Map<string, ServerRow>();
	logById = new Map<string, LogRow>();
	commandById = new Map<string, CommandRow>();
	groupById = new Map<string, CommandGroupRow>();
	annotationById = new Map<string, AnnotationRow>();
	tagById = new Map<string, TagRow>();
	linkById = new Map<string, LinkRow>();
	operatorById = new Map<string, OperatorRow>();
	commandsByBeacon = new Map<string, CommandRow[]>();
	commandsByOperator = new Map<string, CommandRow[]>();
	logsByBeacon = new Map<string, LogRow[]>();
	outputByCommand = new Map<string, LogRow[]>();
	beaconsByHost = new Map<string, BeaconRow[]>();
	beaconsByServer = new Map<string, BeaconRow[]>();
	beaconsByOperator = new Map<string, BeaconRow[]>();
	groupsByCommand = new Map<string, CommandGroupRow[]>();
	annotationsByGroup = new Map<string, AnnotationRow[]>();
	annotationsByTag = new Map<string, AnnotationRow[]>();

	constructor(p: Project) {
		const push = <T>(map: Map<string, T[]>, key: string | null | undefined, value: T) => {
			if (!key) return;
			const list = map.get(key);
			if (list) list.push(value);
			else map.set(key, [value]);
		};
		for (const b of p.beacons) {
			this.beaconById.set(b.id, b);
			push(this.beaconsByHost, b.hostId, b);
			push(this.beaconsByServer, b.serverId, b);
			for (const o of b.operatorIds) push(this.beaconsByOperator, o, b);
		}
		for (const h of p.hosts) this.hostById.set(h.id, h);
		for (const s of p.servers) this.serverById.set(s.id, s);
		for (const l of p.logs) {
			this.logById.set(l.id, l);
			push(this.logsByBeacon, l.beaconId, l);
			push(this.outputByCommand, l.commandId, l);
		}
		for (const list of this.outputByCommand.values()) list.sort((a, b) => a.lineNumber - b.lineNumber);
		for (const c of p.commands) {
			this.commandById.set(c.id, c);
			push(this.commandsByBeacon, c.beaconId, c);
			push(this.commandsByOperator, c.operatorId, c);
		}
		for (const g of p.commandGroups) {
			this.groupById.set(g.id, g);
			for (const cId of g.commandIds) push(this.groupsByCommand, cId, g);
		}
		for (const a of p.annotations) {
			this.annotationById.set(a.id, a);
			push(this.annotationsByGroup, a.commandGroupId, a);
			for (const t of a.tagIds) push(this.annotationsByTag, t, a);
		}
		for (const t of p.tags) this.tagById.set(t.id, t);
		for (const l of p.links) this.linkById.set(l.id, l);
		for (const o of p.operators) this.operatorById.set(o.id, o);
	}
}

export type Project = Seed & { campaignId: string; seedId: string };

class DemoDb {
	campaigns: CampaignRow[] = [];
	globalOperators: string[] = [];
	private mutable: Record<string, MutableProject> = {};
	private projects = new Map<string, Project>();
	private indexes = new Map<string, ProjectIndex>();

	constructor() {
		this.load();
	}

	private load() {
		let state: PersistedState | undefined;
		try {
			const raw = storage?.getItem(STORAGE_KEY);
			if (raw) state = JSON.parse(raw);
		} catch {
			state = undefined;
		}
		if (state?.version === STATE_VERSION) {
			this.campaigns = state.campaigns;
			this.globalOperators = state.globalOperators;
			this.mutable = state.projects;
		} else {
			this.campaigns = clone(defaultCampaigns);
			this.globalOperators = [];
			this.mutable = {};
		}
	}

	save() {
		try {
			const state: PersistedState = {
				version: STATE_VERSION,
				campaigns: this.campaigns,
				globalOperators: this.globalOperators,
				projects: this.mutable,
			};
			storage?.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn('RedEye demo: unable to persist state', e);
		}
	}

	/** Forget every change made during this session */
	reset() {
		try {
			storage?.removeItem(STORAGE_KEY);
		} catch {
			// ignore
		}
		this.projects.clear();
		this.indexes.clear();
		this.load();
	}

	campaign(campaignId: string) {
		const campaign = this.campaigns.find((c) => c.id === campaignId);
		if (!campaign) throw new Error('campaignId is invalid');
		return campaign;
	}

	project(campaignId: string): Project {
		const cached = this.projects.get(campaignId);
		if (cached) return cached;
		const campaign = this.campaign(campaignId);
		const seed = seeds[campaign.seedId];
		if (!seed) throw new Error(`Missing demo dataset "${campaign.seedId}"`);
		if (!this.mutable[campaignId]) this.mutable[campaignId] = mutableFromSeed(seed);
		const project: Project = {
			...this.mutable[campaignId],
			logs: seed.logs,
			commands: seed.commands,
			images: seed.images,
			files: seed.files,
			campaignId,
			seedId: campaign.seedId,
		};
		this.projects.set(campaignId, project);
		return project;
	}

	index(campaignId: string): ProjectIndex {
		let index = this.indexes.get(campaignId);
		if (!index) {
			index = new ProjectIndex(this.project(campaignId));
			this.indexes.set(campaignId, index);
		}
		return index;
	}

	/** Run a change against a campaign's editable tables, then re-index and persist. */
	mutate<T>(campaignId: string, fn: (p: Project, idx: ProjectIndex) => T): T {
		const p = this.project(campaignId);
		const result = fn(p, this.index(campaignId));
		// keep the persisted tables pointing at the (possibly replaced) arrays
		const m = this.mutable[campaignId];
		for (const key of Object.keys(m) as (keyof MutableProject)[]) (m as any)[key] = p[key];
		this.indexes.delete(campaignId);
		this.save();
		return result;
	}

	addCampaign(row: CampaignRow) {
		this.campaigns.push(row);
		this.save();
	}

	/** Point a campaign at a different dataset, discarding its edits */
	setCampaignSeed(campaignId: string, seedId: string) {
		this.campaign(campaignId).seedId = seedId;
		delete this.mutable[campaignId];
		this.projects.delete(campaignId);
		this.indexes.delete(campaignId);
		this.save();
	}

	deleteCampaign(campaignId: string) {
		this.campaigns = this.campaigns.filter((c) => c.id !== campaignId);
		delete this.mutable[campaignId];
		this.projects.delete(campaignId);
		this.indexes.delete(campaignId);
		this.save();
	}

	ensureGlobalOperator(name: string) {
		if (name && !this.globalOperators.includes(name)) {
			this.globalOperators.push(name);
			this.save();
		}
	}
}

export const db = new DemoDb();
