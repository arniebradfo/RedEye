/**
 * Browser ports of the RedEye server's type-graphql resolvers (applications/server/src/store on the develop branch).
 * Each resolver works on the in-memory demo database instead of MikroORM/SQLite.
 */
import type {
	AnnotationRow,
	BeaconRow,
	CampaignRow,
	CommandGroupRow,
	CommandRow,
	HostRow,
	LinkRow,
	LogRow,
	OperatorRow,
	Project,
	ProjectIndex,
	ServerRow,
	TagRow,
} from './db';
import { db } from './db';
import { seeds, uploadSeedId } from './seeds';

export type DemoContext = { campaignId?: string; hidden: boolean };
type Args = Record<string, any>;
type Resolver<S = any> = (source: S, args: Args, ctx: DemoContext) => unknown;

export const uuid = (): string =>
	typeof crypto?.randomUUID === 'function'
		? crypto.randomUUID()
		: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
				const r = (Math.random() * 16) | 0;
				return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
		  });

/** Point the context at a campaign; nested type resolvers read from it */
const use = (ctx: DemoContext, campaignId: string, hidden = false) => {
	ctx.campaignId = campaignId;
	ctx.hidden = !!hidden;
	return { p: db.project(campaignId), idx: db.index(campaignId) };
};
const P = (ctx: DemoContext): Project => db.project(ctx.campaignId!);
const I = (ctx: DemoContext): ProjectIndex => db.index(ctx.campaignId!);

const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);
const sum = <T>(items: T[], fn: (item: T) => number) => items.reduce((acc, item) => acc + fn(item), 0);
const unique = <T>(items: T[]) => Array.from(new Set(items));
const like = (haystack: string | null | undefined, needle: string) =>
	!!haystack && haystack.toLowerCase().includes(needle.toLowerCase());

// ---------- visibility helpers (mirrors server/src/store/utils/hidden-entities-helper.ts) ----------

const beaconOf = (idx: ProjectIndex, id?: string | null) => (id ? idx.beaconById.get(id) : undefined);
const commandVisible = (idx: ProjectIndex, c: CommandRow, hidden: boolean) =>
	hidden || !beaconOf(idx, c.beaconId)?.hidden;
const beaconVisible = (idx: ProjectIndex, b: BeaconRow, hidden: boolean) =>
	hidden || (!b.hidden && !idx.hostById.get(b.hostId)?.hidden);
const linkVisible = (idx: ProjectIndex, l: LinkRow, hidden: boolean) =>
	hidden || (beaconOf(idx, l.originId)?.hidden === false && beaconOf(idx, l.destinationId)?.hidden === false);
const groupVisible = (idx: ProjectIndex, g: CommandGroupRow, hidden: boolean) =>
	hidden || g.commandIds.some((id) => {
		const c = idx.commandById.get(id);
		return c && commandVisible(idx, c, false);
	});

// ---------- derived values ----------

const commandCommentsCount = (idx: ProjectIndex, commandId: string) =>
	sum(idx.groupsByCommand.get(commandId) ?? [], (g) => idx.annotationsByGroup.get(g.id)?.length ?? 0);
const beaconCommandsCount = (idx: ProjectIndex, beaconId: string) => idx.commandsByBeacon.get(beaconId)?.length ?? 0;
const beaconCommentsCount = (idx: ProjectIndex, beaconId: string) =>
	sum(idx.commandsByBeacon.get(beaconId) ?? [], (c) => commandCommentsCount(idx, c.id));
const beaconLogsCount = (idx: ProjectIndex, beaconId: string) => idx.logsByBeacon.get(beaconId)?.length ?? 0;

const mitreNames: Record<string, string> = {
	Collection: 'Collection',
	'Command&Control': 'CommandAndControl',
	CommandAndControl: 'CommandAndControl',
	CredentialAccess: 'CredentialAccess',
	DefenseEvasion: 'DefenseEvasion',
	Discovery: 'Discovery',
	Execution: 'Execution',
	Exfiltration: 'Exfiltration',
	Impact: 'Impact',
	GoldenTicket: 'GoldenTicket',
	InitialAccess: 'InitialAccess',
	LateralMovement: 'LateralMovement',
	Persistence: 'Persistence',
	PrivilegeEscalation: 'PrivilegeEscalation',
	Reconnaissance: 'Reconnaissance',
	ResourceDevelopment: 'ResourceDevelopment',
};
const commandMitre = (idx: ProjectIndex, commandId: string) => {
	const techniques = new Set<string>();
	for (const g of idx.groupsByCommand.get(commandId) ?? [])
		for (const a of idx.annotationsByGroup.get(g.id) ?? [])
			for (const tagId of a.tagIds) {
				const text = idx.tagById.get(tagId)?.text;
				if (text && mitreNames[text]) techniques.add(mitreNames[text]);
			}
	return Array.from(techniques);
};

const logTimeRangeCache = new Map<string, { first?: string; last?: string }>();
const logTimeRange = (seedId: string) => {
	let range = logTimeRangeCache.get(seedId);
	if (!range) {
		const times = seeds[seedId].logs
			.map((l) => l.dateTime)
			.filter((d): d is string => !!d)
			.sort();
		range = { first: times[0], last: times[times.length - 1] };
		logTimeRangeCache.set(seedId, range);
	}
	return range;
};

const commandTime = (idx: ProjectIndex, c: CommandRow) => time(idx.logById.get(c.inputId)?.dateTime);

// ---------- sorting ----------

const directional = (direction: string | undefined, compare: number) => (direction === 'DESC' ? -compare : compare);
const compareValues = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

const sortCommands = (idx: ProjectIndex, commands: CommandRow[], sort: Args = { sortBy: 'name' }) => {
	const key =
		sort?.sortBy === 'time' ? (c: CommandRow) => commandTime(idx, c) : (c: CommandRow) => c.inputText.toLowerCase();
	return [...commands].sort((a, b) => directional(sort?.direction, compareValues(key(a), key(b))));
};

/** Sort command groups by a property of their annotations (MikroORM ordered by the joined annotation rows) */
const sortGroups = (
	idx: ProjectIndex,
	groups: CommandGroupRow[],
	by: 'date' | 'user' | 'favorite' | 'commandTime',
	direction: string = 'ASC'
) => {
	const key = (g: CommandGroupRow): any => {
		if (by === 'commandTime')
			return Math.min(
				...g.commandIds.map((id) => {
					const c = idx.commandById.get(id);
					return c ? commandTime(idx, c) : Infinity;
				})
			);
		const annotations = idx.annotationsByGroup.get(g.id) ?? [];
		if (by === 'date') return Math.min(...annotations.map((a) => time(a.date)));
		if (by === 'user') return annotations[0]?.user?.toLowerCase() ?? '';
		return annotations.some((a) => a.favorite) ? 1 : 0;
	};
	return [...groups].sort((a, b) => directional(direction, compareValues(key(a), key(b))));
};
const commentSortKey = (sortBy?: string) => (sortBy === 'user' ? 'user' : sortBy === 'fav' ? 'favorite' : 'date');

// ---------- hiding (ensureTreeHidden / getNonHidableEntities) ----------

const ensureTreeHidden = (p: Project, idx: ProjectIndex, id: string, hidden: boolean, toHide: string[], seen = new Set<string>()) => {
	if (seen.has(id)) return;
	seen.add(id);
	for (const link of p.links.filter((l) => l.originId === id)) {
		const destination = beaconOf(idx, link.destinationId);
		if (destination) {
			const destinationLinks = p.links.filter((l) => l.destinationId === destination.id);
			if (destinationLinks.every((l) => beaconOf(idx, l.originId)?.hidden === hidden || toHide.includes(l.originId || ''))) {
				destination.hidden = hidden;
				ensureTreeHidden(p, idx, destination.id, hidden, toHide, seen);
			}
		}
	}
	const origin = beaconOf(idx, id);
	const host = origin && idx.hostById.get(origin.hostId);
	if (host) host.hidden = !(idx.beaconsByHost.get(host.id) ?? []).some((b) => !b.hidden);
};

const nonHidableEntities = (p: Project, idx: ProjectIndex, beaconsToHide: string[] = [], hostsToHide: string[] = []) => {
	const isServerBeacon = (b: BeaconRow) => !!idx.hostById.get(b.hostId)?.cobaltStrikeServer;
	const beaconsCount = beaconsToHide.length ? p.beacons.filter((b) => !b.hidden && !isServerBeacon(b)).length : 0;
	const beaconsNotHidden = beaconsToHide.length
		? p.beacons.filter((b) => beaconsToHide.includes(b.id) && !b.hidden && !isServerBeacon(b))
		: [];
	const hostHasVisibleBeacon = (h: HostRow) => (idx.beaconsByHost.get(h.id) ?? []).some((b) => !b.hidden);
	const notHiddenHosts = p.hosts.filter((h) => !h.hidden && !h.cobaltStrikeServer && hostHasVisibleBeacon(h));

	const cantHideBeacons: string[] = [];
	const hiddenHosts: Record<string, { beaconIds: string[]; hiddenBeaconIds: string[] }> = {};
	const willBeHidden: string[] = [];

	const findTree = (id: string, seen = new Set<string>()): string | void => {
		if (seen.has(id)) return;
		seen.add(id);
		for (const link of p.links.filter((l) => l.originId === id)) {
			const destination = beaconOf(idx, link.destinationId);
			if (destination) {
				const destinationLinks = destination.hidden ? [] : p.links.filter((l) => l.destinationId === destination.id);
				if (
					destinationLinks.length &&
					destinationLinks.every((l) => beaconOf(idx, l.originId)?.hidden === false || beaconsToHide.includes(l.originId || ''))
				) {
					const final = findTree(destination.id, seen);
					if (final) return final;
				}
			}
		}
		if (!willBeHidden.includes(id)) willBeHidden.push(id);
		const origin = beaconOf(idx, id);
		if (origin?.hostId) {
			if (!(origin.hostId in hiddenHosts))
				hiddenHosts[origin.hostId] = {
					beaconIds: (idx.beaconsByHost.get(origin.hostId) ?? []).map((b) => b.id),
					hiddenBeaconIds: [],
				};
			hiddenHosts[origin.hostId].hiddenBeaconIds.push(id);
		}
		if (willBeHidden.length === beaconsCount) return id;
	};

	for (const beacon of beaconsNotHidden) {
		findTree(beacon.id);
		if (willBeHidden.length >= beaconsCount) cantHideBeacons.push(beacon.id);
		const entries = Object.entries(hiddenHosts);
		if (
			entries.length &&
			entries.every(([, host]) => host.beaconIds.length === host.hiddenBeaconIds.length) &&
			entries.length === notHiddenHosts.length
		)
			cantHideBeacons.push(beacon.id);
	}

	const checkCanHide = (entities: unknown[], hiddenIds: string[]) =>
		(entities.length > 1 && hiddenIds.length - 1 !== entities.length) || entities.length !== 1;

	const hosts = hostsToHide.length ? p.hosts.filter((h) => hostsToHide.includes(h.id) && !h.cobaltStrikeServer) : [];
	const canHideHosts: string[] = [];
	const cantHideHosts = hosts.filter((host) => {
		if (checkCanHide(notHiddenHosts, canHideHosts)) {
			canHideHosts.push(host.id);
			return false;
		}
		return true;
	});

	const servers = hostsToHide.length ? p.servers.filter((s) => hostsToHide.includes(s.id)) : [];
	const notHiddenServers = p.hosts.filter((h) => !h.hidden && h.cobaltStrikeServer && hostHasVisibleBeacon(h));
	const canHideServers: string[] = [];
	const cantHideServers = servers.filter((server) => {
		if (checkCanHide(notHiddenServers, canHideServers)) {
			canHideServers.push(server.id);
			return false;
		}
		return true;
	});

	return {
		beacons: unique(cantHideBeacons),
		hosts: cantHideHosts.map((h) => h.id),
		servers: cantHideServers.map((s) => s.id),
	};
};

// ---------- presentation mode (presentation-resolvers.ts) ----------

type LinkTree = Record<string, { parents: string[] }>;

const buildLinkTree = (p: Project): LinkTree => {
	const items: Record<string, Set<string>> = {};
	for (const link of p.links) {
		if (link.originId && !items[link.originId]) items[link.originId] = new Set();
		if (link.destinationId && !items[link.destinationId]) items[link.destinationId] = new Set();
		if (link.originId && link.destinationId) items[link.destinationId].add(link.originId);
	}
	return Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { parents: Array.from(v) }]));
};

const shortestPathDfs = (startNode: string, allNodes: string[], linkTree: LinkTree) => {
	const previous = new Map<string, string>();
	previous.set(startNode, startNode);
	const dfs = (current: string, depth = 0) => {
		if (depth > 500) return;
		for (const neighbor of linkTree[current]?.parents ?? []) {
			if (previous.has(neighbor)) continue;
			previous.set(neighbor, current);
			if (neighbor !== startNode && allNodes.includes(startNode)) break;
			dfs(neighbor, depth + 1);
		}
	};
	dfs(startNode);
	return Array.from(previous.keys());
};

const getBeaconLinks = (p: Project, idx: ProjectIndex, groups: CommandGroupRow[], linkTree: LinkTree, hidden: boolean) => {
	const allBeaconIds: string[] = [];
	const commandGroups: any[] = [];
	for (const group of groups) {
		if (!idx.annotationsByGroup.get(group.id)?.length) continue;
		let minDate: number | undefined;
		let maxDate: number | undefined;
		const beaconIds = new Set<string>();
		for (const commandId of group.commandIds) {
			const command = idx.commandById.get(commandId);
			if (!command || !commandVisible(idx, command, hidden)) continue;
			const t = commandTime(idx, command);
			if (t) {
				if (minDate === undefined || t <= minDate) minDate = t;
				if (maxDate === undefined || t >= maxDate) maxDate = t;
			}
			const serverId = beaconOf(idx, command.beaconId)?.serverId;
			if (serverId) beaconIds.add(serverId);
			beaconIds.add(command.beaconId);
		}
		const ids = Array.from(beaconIds);
		allBeaconIds.push(...ids);
		commandGroups.push({
			id: group.id,
			beaconIds: ids,
			commandIds: group.commandIds,
			minDate: minDate !== undefined ? new Date(minDate).toISOString() : null,
			maxDate: maxDate !== undefined ? new Date(maxDate).toISOString() : null,
		});
	}
	const presentationBeacons = unique(allBeaconIds);
	const beaconIds = unique(presentationBeacons.flatMap((id) => shortestPathDfs(id, presentationBeacons, linkTree)));
	const linkIds = p.links
		.filter((l) => beaconIds.includes(l.originId || '') && beaconIds.includes(l.destinationId || ''))
		.map((l) => l.id);
	return {
		beaconIds,
		connectionBeaconIds: beaconIds.filter((id) => !allBeaconIds.includes(id)),
		linkIds,
		commandGroups,
	};
};

const presentationItems = (args: Args, ctx: DemoContext) => {
	const { p, idx } = use(ctx, args.campaignId, args.hidden);
	const hidden = !!args.hidden;
	const listSort = args.listSort ?? { sortBy: 'alphabetical' };
	const commentsTabSort = args.commentsTabSort ?? { sortBy: 'minTime' };
	const linkTree = buildLinkTree(p);
	const items: any[] = [];

	const ordered = (groups: CommandGroupRow[]) => {
		const visible = groups.filter((g) => groupVisible(idx, g, hidden));
		if (!args.forOverviewComments) return sortGroups(idx, visible, 'commandTime', 'ASC');
		const by =
			commentsTabSort.sortBy === 'minTime' ? 'date' : commentsTabSort.sortBy === 'fav' ? 'favorite' : 'user';
		return sortGroups(idx, visible, by, commentsTabSort.direction);
	};
	const makeItem = (id: string, key: string, groups: CommandGroupRow[]) => {
		const links = getBeaconLinks(p, idx, groups, linkTree, hidden);
		return {
			id,
			key,
			count: groups.length,
			commandCount: sum(links.commandGroups, (g) => g.commandIds.length),
			commandGroupIds: links.commandGroups.map((g) => g.id),
			...links,
		};
	};
	const sortList = (list: any[]) => {
		const dir = listSort.direction;
		if (listSort.sortBy === 'alphabetical') list.sort((a, b) => directional(dir, a.id.localeCompare(b.id)));
		if (listSort.sortBy === 'commentCount') list.sort((a, b) => directional(dir, a.count - b.count));
		if (listSort.sortBy === 'commandCount') list.sort((a, b) => directional(dir, a.commandCount - b.commandCount));
		return list;
	};
	const groupsWhere = (fn: (a: AnnotationRow) => boolean) =>
		ordered(p.commandGroups.filter((g) => (idx.annotationsByGroup.get(g.id) ?? []).some(fn)));

	if (!args.userOnly) {
		const all = ordered(p.commandGroups);
		const allItem = makeItem('all', 'All Comments', all);
		allItem.count = allItem.commandGroups.length;
		items.push(allItem);
		items.push(makeItem('favorited', 'Favorited Comments', groupsWhere((a) => a.favorite)));
		items.push(makeItem('procedural', 'parser-generated', groupsWhere((a) => a.generation === 'PROCEDURAL')));
	}

	const byUser: Record<string, CommandGroupRow[]> = {};
	for (const group of groupsWhere((a) => a.generation === 'MANUAL')) {
		const user = idx.annotationsByGroup.get(group.id)?.[0]?.user ?? '';
		(byUser[user] ||= []).push(group);
	}
	items.push(...sortList(Object.entries(byUser).map(([user, groups]) => makeItem(`user-${user}`, `user-${user}`, groups))));

	if (!args.userOnly) {
		const byTag = p.tags
			.map((tag) => ({ tag, groups: groupsWhere((a) => a.tagIds.includes(tag.id)) }))
			.filter(({ groups }) => groups.length)
			.map(({ tag, groups }) => makeItem(`tag-${tag.text}`, `#${tag.text}`, groups));
		items.push(...sortList(byTag));
	}
	return items;
};

// ---------- timeline (timeline-resolvers.ts) ----------

const validBucketMinuteIncrements = [2, 4, 6, 10, 12, 15, 20, 30, 60];
const validBucketHourIncrements = [1, 2, 4, 6, 8, 12, 24];
const identifyBucketSize = (maxBuckets: number, campaignMinutes: number) => {
	const campaignHours = Math.ceil(campaignMinutes / 60);
	if (campaignMinutes <= maxBuckets) return { numberOfBuckets: Math.ceil(campaignMinutes), bucketMinutes: 1 };
	if (campaignHours <= maxBuckets) {
		const minimum = Math.ceil(campaignMinutes / maxBuckets);
		const bucketMinutes = validBucketMinuteIncrements.find((inc) => inc >= minimum) ?? 60;
		return { numberOfBuckets: Math.ceil(campaignMinutes / bucketMinutes), bucketMinutes };
	}
	const minimumHours = Math.ceil(campaignHours / maxBuckets);
	const bucketHours =
		validBucketHourIncrements.find((inc) => inc >= minimumHours) ?? Math.ceil(minimumHours / 24) * 24;
	const bucketMinutes = bucketHours * 60;
	return { numberOfBuckets: Math.ceil(campaignMinutes / bucketMinutes), bucketMinutes };
};

const timeline = (args: Args, ctx: DemoContext) => {
	const { p, idx } = use(ctx, args.campaignId, args.hidden);
	const hidden = !!args.hidden;
	const suggestedStartTime = new Date(args.suggestedStartTime ?? 1);
	const suggestedEndTime = new Date(args.suggestedEndTime ?? 8640000000000000 - 600000);
	const beacons = p.beacons.filter((b) => beaconVisible(idx, b, hidden));
	const logTimes = p.logs
		// the server's `{ beacon: { hidden } }` filter is an inner join, so it also drops logs without a beacon
		.filter((l) => {
			const beacon = beaconOf(idx, l.beaconId);
			return hidden || (!!beacon && !beacon.hidden);
		})
		.map((l) => time(l.dateTime))
		.filter(Boolean);
	const commands = p.commands.filter((c) => commandVisible(idx, c, hidden));
	const links = p.links.filter((l) => linkVisible(idx, l, hidden));

	const campaignStartTime = new Date(logTimes.length ? Math.min(...logTimes) : 8640000000000000);
	const campaignEndTime = new Date(logTimes.length ? Math.max(...logTimes) : -8640000000000000);
	campaignStartTime.setSeconds(0, 0);
	campaignEndTime.setSeconds(60, 0);
	suggestedStartTime.setSeconds(0, 0);
	suggestedEndTime.setSeconds(60, 0);

	const startsBeforeSuggested = suggestedStartTime > campaignStartTime;
	const endsAfterSuggested = suggestedEndTime < campaignEndTime;
	const usedStartTime = startsBeforeSuggested ? suggestedStartTime : campaignStartTime;
	const usedEndTime = endsAfterSuggested ? suggestedEndTime : campaignEndTime;
	const timelineMinutes = (usedEndTime.valueOf() - usedStartTime.valueOf()) / 60000;
	const { numberOfBuckets, bucketMinutes } = identifyBucketSize(args.suggestedBuckets ?? 100, timelineMinutes);

	const extraStart = startsBeforeSuggested ? 0 : 1;
	const extraEnd = endsAfterSuggested ? 0 : 1;
	const finalNumberOfBuckets = numberOfBuckets + extraStart + extraEnd;
	const bucketStartTime = new Date(usedStartTime);
	bucketStartTime.setMinutes(bucketStartTime.getMinutes() - extraStart * bucketMinutes);
	const bucketEndTime = new Date(usedEndTime);
	bucketEndTime.setMinutes(bucketEndTime.getMinutes() + 1);
	const start = bucketStartTime.getTime();

	const buckets = new Array(finalNumberOfBuckets).fill(1).map((_, i) => {
		let bucketEnd = new Date(start + (i + 1) * bucketMinutes * 60000);
		let bucketStart = new Date(start + i * bucketMinutes * 60000);
		if (i === finalNumberOfBuckets - 2 && bucketEndTime.valueOf() < bucketEnd.valueOf())
			bucketEnd = new Date(bucketEndTime.getTime() - 60000);
		if (i === finalNumberOfBuckets - 1) {
			bucketStart = new Date(bucketEndTime.getTime() - 60000);
			bucketEnd = bucketEndTime;
		}
		return {
			createdLinks: [] as string[],
			activeLinks: [] as string[],
			dyingLinks: [] as string[],
			deadLinks: [] as string[],
			createdBeacons: [] as string[],
			activeBeacons: [] as string[],
			dyingBeacons: [] as string[],
			deadBeacons: [] as string[],
			beaconCommandCountPair: [] as { beaconId: string; commandCount: number }[],
			bucketStartTime: bucketStart.toISOString(),
			bucketEndTime: bucketEnd.toISOString(),
		};
	});
	const bucketIndex = (t: number) => Math.floor((t - start) / 60000 / bucketMinutes);

	for (const command of commands) {
		const t = commandTime(idx, command);
		if (!t) continue;
		const i = bucketIndex(t);
		if (i >= 0 && i < finalNumberOfBuckets) {
			const pair = buckets[i].beaconCommandCountPair.find((x) => x.beaconId === command.beaconId);
			if (pair) pair.commandCount++;
			else buckets[i].beaconCommandCountPair.push({ beaconId: command.beaconId, commandCount: 1 });
		}
	}

	const place = (
		id: string,
		startIso: string | null | undefined,
		endIso: string | null | undefined,
		lists: { created: 'createdBeacons' | 'createdLinks'; active: string; dying: string; dead: string }
	) => {
		if (!startIso) return;
		const startIndex = Math.max(0, bucketIndex(time(startIso)));
		const endIndex = bucketIndex(endIso ? time(endIso) : campaignEndTime.getTime());
		(buckets[startIndex] as any)?.[lists.created]?.push(id);
		for (let i = startIndex; i < finalNumberOfBuckets; i++) {
			if (i < endIndex) (buckets[i] as any)[lists.active].push(id);
			else if (i === endIndex) (buckets[i] as any)[lists.dying].push(id);
			else (buckets[i] as any)[lists.dead].push(id);
		}
	};

	for (const beacon of beacons) {
		if (!beacon.meta.length) continue;
		if (idx.hostById.get(beacon.hostId)?.cobaltStrikeServer) {
			for (const bucket of buckets) bucket.activeBeacons.push(beacon.id);
		} else {
			place(beacon.id, beacon.meta[0].startTime, beacon.meta[0].endTime, {
				created: 'createdBeacons',
				active: 'activeBeacons',
				dying: 'dyingBeacons',
				dead: 'deadBeacons',
			});
		}
	}
	for (const link of links)
		place(link.id, link.startTime, link.endTime, {
			created: 'createdLinks',
			active: 'activeLinks',
			dying: 'dyingLinks',
			dead: 'deadLinks',
		});

	return {
		bucketStartTime: bucketStartTime.toISOString(),
		bucketEndTime: bucketEndTime.toISOString(),
		campaignStartTime: campaignStartTime.toISOString(),
		campaignEndTime: campaignEndTime.toISOString(),
		bucketMinutes,
		buckets,
	};
};

// ---------- command & command group filters ----------

const filterCommands = (args: Args, ctx: DemoContext) => {
	const { p, idx } = use(ctx, args.campaignId, args.hidden);
	const hidden = !!args.hidden;
	let commands: CommandRow[];
	if (args.commandIds?.length) {
		commands = args.commandIds.map((id: string) => idx.commandById.get(id)).filter(Boolean);
		commands = commands.filter((c) => commandVisible(idx, c, hidden));
	} else if (args.commandType) {
		commands = p.commands.filter((c) => c.inputText === args.commandType && commandVisible(idx, c, hidden));
	} else if (args.operatorId) {
		commands = (idx.commandsByOperator.get(args.operatorId) ?? []).filter((c) => commandVisible(idx, c, hidden));
	} else if (args.beaconId) {
		commands = (idx.commandsByBeacon.get(args.beaconId) ?? []).filter((c) => commandVisible(idx, c, hidden));
	} else if (args.hostId) {
		commands = (idx.beaconsByHost.get(args.hostId) ?? [])
			.filter((b) => hidden || !b.hidden)
			.flatMap((b) => idx.commandsByBeacon.get(b.id) ?? []);
	} else {
		commands = p.commands.filter((c) => commandVisible(idx, c, hidden));
	}
	return sortCommands(idx, commands, args.sort);
};

const filterCommandGroups = (args: Args, ctx: DemoContext) => {
	const { p, idx } = use(ctx, args.campaignId, args.hidden);
	const hidden = !!args.hidden;
	const hasCommand = (g: CommandGroupRow, fn: (c: CommandRow) => boolean) =>
		g.commandIds.some((id) => {
			const c = idx.commandById.get(id);
			return !!c && fn(c);
		});
	const visible = (c: CommandRow) => commandVisible(idx, c, hidden);
	let groups: CommandGroupRow[];
	if (args.commandGroupIds?.length) {
		groups = p.commandGroups.filter((g) => args.commandGroupIds.includes(g.id) && (hidden || hasCommand(g, visible)));
	} else if (args.commandIds) {
		groups = p.commandGroups.filter((g) => hasCommand(g, (c) => args.commandIds.includes(c.id) && visible(c)));
	} else if (args.commandType) {
		groups = p.commandGroups.filter((g) => hasCommand(g, (c) => c.inputText === args.commandType && visible(c)));
	} else if (args.operatorId) {
		const beaconIds = (idx.beaconsByOperator.get(args.operatorId) ?? []).map((b) => b.id);
		groups = p.commandGroups.filter((g) => hasCommand(g, (c) => beaconIds.includes(c.beaconId) && visible(c)));
	} else if (args.beaconId) {
		groups = p.commandGroups.filter((g) => hasCommand(g, (c) => c.beaconId === args.beaconId && visible(c)));
	} else if (args.hostId) {
		const beaconIds = (idx.beaconsByHost.get(args.hostId) ?? []).filter((b) => hidden || !b.hidden).map((b) => b.id);
		groups = p.commandGroups.filter((g) => hasCommand(g, (c) => beaconIds.includes(c.beaconId) && visible(c)));
	} else {
		groups = p.commandGroups.filter((g) => hidden || hasCommand(g, visible));
	}
	const sort = args.sort ?? { sortBy: 'time' };
	return sortGroups(idx, groups, commentSortKey(sort.sortBy), sort.direction);
};

// ---------- tags & annotations ----------

const findOrCreateTags = (p: Project, texts: string[]) =>
	unique(texts.map((t) => t.trim()).filter(Boolean)).map((text) => {
		let tag = p.tags.find((t) => t.text === text);
		if (!tag) {
			tag = { id: text, text };
			p.tags.push(tag);
		}
		return tag.id;
	});

const createAnnotation = (p: Project, args: Args, commandGroupId: string): AnnotationRow => {
	const annotation: AnnotationRow = {
		id: uuid(),
		text: args.text,
		generation: 'MANUAL',
		date: new Date().toISOString(),
		user: args.user,
		favorite: !!args.favorite,
		commandGroupId,
		tagIds: findOrCreateTags(p, args.tags ?? []),
	};
	p.annotations.push(annotation);
	return annotation;
};

// ---------- parser info ----------

const parserInfo = [
	{
		id: 'cobalt-strike-parser',
		name: 'Cobalt Strike Parser',
		version: 1,
		uploadForm: {
			serverDelineation: 'Folder',
			enabledInBlueTeam: false,
			tabTitle: 'Cobalt Strike',
			fileUpload: {
				type: 'Directory',
				validate: 'Parser',
				description:
					'Select a single Campaign Folder that contains CobaltStrike Server Folders.\n' +
					'Each Server Folder should contain beacon logs in dated (YYMMDD) folders.',
				example: `Campaign_Folder
- Server_Folder_1
  - 200101
  - 200102
  - ...
- Server_Folder_2
  - 200105
  - 200121
  - ...`,
				acceptedExtensions: null,
			},
			fileDisplay: { editable: true },
		},
	},
	...[
		{
			id: 'brute-ratel-parser',
			name: 'Brute Ratel Parser',
			tabTitle: 'Brute Ratel',
			description: 'Upload the Brute Ratel log folder containing an autosave.profile and logs folder',
		},
		{
			id: 'sliver-parser',
			name: 'Sliver Parser',
			tabTitle: 'Sliver',
			description: 'Upload the Sliver log folder containing a sliver.db file and json_*.log files',
		},
	].map(({ id, name, tabTitle, description }) => ({
		id,
		name,
		version: 1,
		uploadForm: {
			serverDelineation: 'Database',
			enabledInBlueTeam: false,
			tabTitle,
			fileUpload: { type: 'Directory', validate: 'Parser', description, example: null, acceptedExtensions: null },
			fileDisplay: { editable: true },
		},
	})),
];

// ---------- root resolvers ----------

export const Query: Record<string, (args: Args, ctx: DemoContext) => unknown> = {
	campaigns: () => db.campaigns,
	campaign: (args) => db.campaign(args.campaignId),
	parserInfo: () => parserInfo,
	parsingProgress: () => ({ date: new Date().toISOString(), nextTaskDescription: '', progress: [] }),
	globalOperators: () => unique([...db.campaigns.map((c) => c.creatorId || ''), ...db.globalOperators]).filter(Boolean).map((id) => ({ id, name: id })),

	servers: (args, ctx) => {
		db.ensureGlobalOperator(args.username);
		const campaign = db.campaign(args.campaignId);
		if (args.username && campaign.lastOpenedById !== args.username) {
			campaign.lastOpenedById = args.username;
			db.save();
		}
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		return args.hidden
			? p.servers
			: p.servers.filter((s) => !s.hidden && (idx.beaconsByServer.get(s.id) ?? []).some((b) => !b.hidden));
	},
	hosts: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		return args.hidden
			? p.hosts
			: p.hosts.filter((h) => !h.hidden && (idx.beaconsByHost.get(h.id) ?? []).some((b) => !b.hidden));
	},
	beacons: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		return p.beacons.filter((b) => beaconVisible(idx, b, !!args.hidden));
	},
	operators: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		return args.hidden
			? p.operators
			: p.operators.filter((o) => (idx.beaconsByOperator.get(o.id) ?? []).some((b) => !b.hidden));
	},
	links: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		return p.links.filter((l) => linkVisible(idx, l, !!args.hidden));
	},
	nonHidableEntities: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId);
		return nonHidableEntities(p, idx, args.beaconIds ?? [], args.hostIds ?? []);
	},

	commands: filterCommands,
	commandIds: (args, ctx) => filterCommands(args, ctx).map((c) => c.id),
	searchCommands: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		const words: string[] = args.searchQuery.split(' ');
		return p.commands.filter((c) => {
			if (!commandVisible(idx, c, !!args.hidden)) return false;
			const input = idx.logById.get(c.inputId);
			const output = idx.outputByCommand.get(c.id) ?? [];
			return words.every(
				(w) =>
					like(input?.blob, w) ||
					like(c.attackIds.join(','), w) ||
					like(input?.filepath, w) ||
					output.some((o) => like(o.blob, w) || like(o.filepath, w))
			);
		});
	},
	commandTypes: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		const counts: Record<string, { count: number; beaconIds: Set<string>; groupIds: Set<string> }> = {};
		for (const c of p.commands) {
			if (!commandVisible(idx, c, !!args.hidden)) continue;
			const entry = (counts[c.inputText] ||= { count: 0, beaconIds: new Set(), groupIds: new Set() });
			entry.count++;
			entry.beaconIds.add(c.beaconId);
			for (const g of idx.groupsByCommand.get(c.id) ?? []) entry.groupIds.add(g.id);
		}
		return Object.entries(counts).map(([text, item]) => ({
			id: text,
			text,
			count: item.count,
			beaconsCount: item.beaconIds.size,
			commentsCount: sum(Array.from(item.groupIds), (id) => idx.annotationsByGroup.get(id)?.length ?? 0),
		}));
	},

	commandGroups: filterCommandGroups,
	commandGroupIds: (args, ctx) => filterCommandGroups(args, ctx).map((g) => g.id),
	commandGroup: (args, ctx) => {
		const { idx } = use(ctx, args.campaignId, args.hidden);
		const group = idx.groupById.get(args.commandGroupId);
		if (!group || !groupVisible(idx, group, !!args.hidden)) throw new Error('CommandGroup not found');
		return group;
	},

	annotations: (args, ctx) => use(ctx, args.campaignId, true).p.annotations,
	annotation: (args, ctx) => {
		const annotation = use(ctx, args.campaignId, true).idx.annotationById.get(args.annotationId);
		if (!annotation) throw new Error('Annotation not found');
		return annotation;
	},
	tags: (args, ctx) => use(ctx, args.campaignId, true).p.tags,
	searchAnnotations: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, args.hidden);
		const words: string[] = args.searchQuery.split(' ');
		return p.annotations.filter((a) => {
			const group = a.commandGroupId ? idx.groupById.get(a.commandGroupId) : undefined;
			if (!args.hidden && !(group && groupVisible(idx, group, false))) return false;
			return words.every(
				(w) => like(a.text, w) || a.tagIds.some((t) => like(idx.tagById.get(t)?.text, w))
			);
		});
	},

	logs: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, true);
		if (args.beaconId) return idx.logsByBeacon.get(args.beaconId) ?? [];
		if (args.hostId)
			return (idx.beaconsByHost.get(args.hostId) ?? []).flatMap((b) => idx.logsByBeacon.get(b.id) ?? []);
		return p.logs;
	},
	logsByBeaconId: (args, ctx) => {
		const { idx } = use(ctx, args.campaignId, true);
		return [...(idx.logsByBeacon.get(args.beaconId) ?? [])].sort(
			(a, b) => compareValues(time(a.dateTime), time(b.dateTime)) || a.lineNumber - b.lineNumber
		);
	},
	logFilesByBeaconId: (args, ctx) => {
		// The server read the original log files from disk; rebuild them from the parsed lines instead
		const { idx } = use(ctx, args.campaignId, true);
		const files = new Map<string, LogRow[]>();
		for (const log of idx.logsByBeacon.get(args.beaconId) ?? []) {
			if (!log.filepath) continue;
			const lines = files.get(log.filepath);
			if (lines) lines.push(log);
			else files.set(log.filepath, [log]);
		}
		return Array.from(files.values()).map((lines) =>
			lines
				.sort((a, b) => a.lineNumber - b.lineNumber)
				.map((l) => l.blob)
				.join('\n')
		);
	},
	images: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, true);
		if (args.beaconId) return p.images.filter((i) => i.beaconId === args.beaconId);
		if (args.hostId) return p.images.filter((i) => beaconOf(idx, i.beaconId)?.hostId === args.hostId);
		return p.images;
	},
	files: (args, ctx) => {
		const { p, idx } = use(ctx, args.campaignId, true);
		if (args.beaconId) return p.files.filter((f) => f.beaconId === args.beaconId);
		if (args.hostId) return p.files.filter((f) => beaconOf(idx, f.beaconId)?.hostId === args.hostId);
		return p.files;
	},

	presentationItems,
	timeline,
};

export const Mutation: Record<string, (args: Args, ctx: DemoContext) => unknown> = {
	createCampaign: (args) => {
		db.ensureGlobalOperator(args.creatorName);
		const campaign: CampaignRow = {
			id: uuid(),
			name: args.name,
			seedId: uploadSeedId,
			creatorId: args.creatorName,
			lastOpenedById: args.creatorName,
			parserName: args.parser,
		};
		db.addCampaign(campaign);
		return campaign;
	},
	deleteCampaign: (args) => {
		db.deleteCampaign(args.campaignId);
		return true;
	},
	renameCampaign: (args) => {
		const campaign = db.campaign(args.campaignId);
		campaign.name = args.name;
		db.save();
		return campaign;
	},
	anonymizeCampaign: (args) => `${args.campaignId}`,
	serversParse: () => true,
	// Cypress-only on the real server: parse a folder of logs on disk. Here a folder named after a bundled
	// dataset (e.g. fixtures/smalldata) switches the campaign to that already-parsed dataset.
	addLocalServerFolder: (args) => {
		const folder = String(args.path).split(/[\\/]/).filter(Boolean).pop() ?? '';
		if (!seeds[folder]) throw new Error('Not available in the demo');
		db.setCampaignSeed(args.campaignId, folder);
		const server = db.project(args.campaignId).servers[0];
		return { ...server, name: args.name };
	},
	createGlobalOperator: (args) => {
		if (db.globalOperators.includes(args.username)) throw new Error('Operator already exists');
		db.ensureGlobalOperator(args.username);
		return { id: args.username, name: args.username };
	},

	updateBeaconMetadata: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const beacon = idx.beaconById.get(args.beaconId);
			if (!beacon) throw new Error('Beacon not found');
			if (args.beaconDisplayName) beacon.displayName = args.beaconDisplayName;
			const meta = beacon.meta[0];
			if (meta) {
				if (args.beaconTimeOfDeath) meta.endTime = new Date(args.beaconTimeOfDeath).toISOString();
				if (args.beaconType) meta.type = args.beaconType;
				if (args.shape) meta.shape = args.shape;
				if (args.color) meta.color = args.color;
			}
			return beacon;
		});
	},
	updateHostMetadata: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const host = idx.hostById.get(args.hostId);
			if (!host) throw new Error('Host not found');
			if (args.hostDisplayName) host.displayName = args.hostDisplayName;
			if (!host.meta.length) host.meta.push({ id: uuid(), shape: 'circle' });
			if (args.shape) host.meta[0].shape = args.shape;
			if (args.color) host.meta[0].color = args.color;
			return host;
		});
	},
	updateServerMetadata: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const server = idx.serverById.get(args.serverId);
			if (!server) throw new Error('Server not found');
			if (args.serverDisplayName) {
				server.displayName = args.serverDisplayName;
				for (const beacon of idx.beaconsByServer.get(server.id) ?? []) {
					const host = idx.hostById.get(beacon.hostId);
					if (host?.cobaltStrikeServer) {
						beacon.displayName = args.serverDisplayName;
						host.displayName = args.serverDisplayName;
					}
				}
			}
			if (args.serverType) server.meta.type = args.serverType;
			if (args.shape) server.meta.shape = args.shape;
			if (args.color) server.meta.color = args.color;
			return server;
		});
	},

	toggleBeaconHidden: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			if (args.beaconId) {
				const beacon = idx.beaconById.get(args.beaconId)!;
				beacon.hidden = !beacon.hidden;
				ensureTreeHidden(p, idx, beacon.id, beacon.hidden, []);
				return [beacon];
			}
			const beacons = (args.beaconIds ?? []).map((id: string) => idx.beaconById.get(id)).filter(Boolean) as BeaconRow[];
			for (const beacon of beacons) {
				if (args.setHidden !== undefined && args.setHidden !== null && beacon.hidden !== args.setHidden) {
					beacon.hidden = args.setHidden;
					ensureTreeHidden(p, idx, beacon.id, beacon.hidden, []);
				}
			}
			return beacons;
		});
	},
	toggleHostHidden: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const apply = (host: HostRow, hidden: boolean) => {
				host.hidden = hidden;
				const beacons = idx.beaconsByHost.get(host.id) ?? [];
				for (const beacon of beacons) {
					beacon.hidden = hidden;
					ensureTreeHidden(p, idx, beacon.id, hidden, beacons.map((b) => b.id));
				}
				host.hidden = hidden;
			};
			if (args.hostId) {
				const host = idx.hostById.get(args.hostId)!;
				apply(host, !host.hidden);
				return [host];
			}
			const hosts = (args.hostIds ?? []).map((id: string) => idx.hostById.get(id)).filter(Boolean) as HostRow[];
			if (args.setHidden !== undefined && args.setHidden !== null) for (const host of hosts) apply(host, args.setHidden);
			return hosts;
		});
	},
	toggleServerHidden: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const apply = (server: ServerRow, hidden: boolean) => {
				server.hidden = hidden;
				for (const beacon of idx.beaconsByServer.get(server.id) ?? []) {
					beacon.hidden = hidden;
					const host = idx.hostById.get(beacon.hostId);
					if (host) host.hidden = hidden;
				}
			};
			if (args.serverId) {
				const server = idx.serverById.get(args.serverId)!;
				apply(server, !server.hidden);
				return [server];
			}
			const servers = (args.serverIds ?? []).map((id: string) => idx.serverById.get(id)).filter(Boolean) as ServerRow[];
			if (args.setHidden !== undefined && args.setHidden !== null) for (const server of servers) apply(server, args.setHidden);
			return servers;
		});
	},

	createLink: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			if (!idx.beaconById.has(args.originId) || !idx.beaconById.has(args.destinationId))
				throw new Error('Beacon not found');
			const command = idx.commandById.get(args.commandId);
			const startTime = command ? idx.logById.get(command.inputId)?.dateTime : null;
			const link: LinkRow = {
				id: uuid(),
				name: args.name,
				manual: true,
				originId: args.originId,
				destinationId: args.destinationId,
				commandId: args.commandId,
				startTime: startTime ?? null,
				endTime: null,
			};
			p.links.push(link);
			return link;
		});
	},
	editLink: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const link = idx.linkById.get(args.id);
			if (!link) throw new Error('Link not found');
			if (args.name !== undefined) link.name = args.name;
			if (args.originId) link.originId = args.originId;
			if (args.destinationId) link.destinationId = args.destinationId;
			if (args.commandId) link.commandId = args.commandId;
			return link;
		});
	},
	deleteLink: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p) => {
			const link = p.links.find((l) => l.id === args.id);
			if (!link) throw new Error('Link not found');
			p.links.splice(p.links.indexOf(link), 1);
			return link;
		});
	},

	addCommandGroupAnnotation: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p) => {
			const group: CommandGroupRow = { id: uuid(), generation: 'MANUAL', commandIds: [...args.commandIds] };
			p.commandGroups.push(group);
			return createAnnotation(p, args, group.id);
		});
	},
	addAnnotationToCommandGroup: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			if (!idx.groupById.has(args.commandGroupId)) throw new Error('CommandGroup not found');
			return createAnnotation(p, args, args.commandGroupId);
		});
	},
	addCommandToCommandGroup: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const group = idx.groupById.get(args.commandGroupId);
			if (!group) throw new Error('CommandGroup not found');
			if (!group.commandIds.includes(args.commandId)) group.commandIds.push(args.commandId);
			return group;
		});
	},
	updateAnnotation: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p, idx) => {
			const annotation = idx.annotationById.get(args.annotationId);
			if (!annotation) throw new Error('Annotation not found');
			annotation.user = args.user || annotation.user;
			annotation.text = args.text;
			if (args.favorite !== undefined && args.favorite !== null) annotation.favorite = args.favorite;
			annotation.tagIds = findOrCreateTags(p, args.tags ?? []);
			return annotation;
		});
	},
	deleteAnnotation: (args, ctx) => {
		use(ctx, args.campaignId);
		return db.mutate(args.campaignId, (p) => {
			const annotation = p.annotations.find((a) => a.id === args.annotationId);
			if (!annotation) throw new Error('Annotation not found');
			p.annotations = p.annotations.filter((a) => a !== annotation);
			const groupId = annotation.commandGroupId;
			if (groupId && !p.annotations.some((a) => a.commandGroupId === groupId))
				p.commandGroups = p.commandGroups.filter((g) => g.id !== groupId);
			return annotation;
		});
	},
};

// ---------- object type field resolvers ----------

const operator = (id?: string | null) => (id ? { id, name: id } : null);

export const Types: Record<string, Record<string, Resolver>> = {
	Campaign: {
		annotationCount: (c: CampaignRow) => db.project(c.id).annotations.length,
		// includes each server's faux beacon; the campaign card subtracts serverCount
		beaconCount: (c: CampaignRow) => db.project(c.id).beacons.length,
		serverCount: (c: CampaignRow) => db.project(c.id).servers.length,
		computerCount: (c: CampaignRow) => db.project(c.id).hosts.filter((h) => !h.cobaltStrikeServer).length,
		commandCount: (c: CampaignRow) => db.project(c.id).commands.length,
		firstLogTime: (c: CampaignRow) => logTimeRange(c.seedId).first,
		lastLogTime: (c: CampaignRow) => logTimeRange(c.seedId).last,
		migrationError: () => false,
		parsingStatus: () => 'PARSING_COMPLETED',
		parsers: (c: CampaignRow) => [{ parserName: c.parserName, path: '' }],
		creator: (c: CampaignRow) => operator(c.creatorId),
		lastOpenedBy: (c: CampaignRow) => operator(c.lastOpenedById),
	},
	Server: {
		beacons: (s: ServerRow, _, ctx) => (I(ctx).beaconsByServer.get(s.id) ?? []).filter((b) => ctx.hidden || !b.hidden),
		beaconCount: (s: ServerRow, _, ctx) =>
			(I(ctx).beaconsByServer.get(s.id) ?? []).filter((b) => ctx.hidden || !b.hidden).length,
		commandsCount: (s: ServerRow, _, ctx) =>
			sum(I(ctx).beaconsByServer.get(s.id) ?? [], (b) => beaconCommandsCount(I(ctx), b.id)),
		logsCount: (s: ServerRow, _, ctx) => sum(I(ctx).beaconsByServer.get(s.id) ?? [], (b) => beaconLogsCount(I(ctx), b.id)),
		commentCount: (s: ServerRow, _, ctx) =>
			sum(I(ctx).beaconsByServer.get(s.id) ?? [], (b) => beaconCommentsCount(I(ctx), b.id)),
	},
	Host: {
		beaconIds: (h: HostRow, _, ctx) =>
			(I(ctx).beaconsByHost.get(h.id) ?? []).filter((b) => ctx.hidden || !b.hidden).map((b) => b.id),
		commandsCount: (h: HostRow, _, ctx) => sum(I(ctx).beaconsByHost.get(h.id) ?? [], (b) => beaconCommandsCount(I(ctx), b.id)),
		commentCount: (h: HostRow, _, ctx) => sum(I(ctx).beaconsByHost.get(h.id) ?? [], (b) => beaconCommentsCount(I(ctx), b.id)),
	},
	Beacon: {
		host: (b: BeaconRow, _, ctx) => I(ctx).hostById.get(b.hostId) ?? null,
		commandsCount: (b: BeaconRow, _, ctx) => beaconCommandsCount(I(ctx), b.id),
		commentsCount: (b: BeaconRow, _, ctx) => beaconCommentsCount(I(ctx), b.id),
		logsCount: (b: BeaconRow, _, ctx) => beaconLogsCount(I(ctx), b.id),
		mitreTechniques: (b: BeaconRow, _, ctx) =>
			unique((I(ctx).commandsByBeacon.get(b.id) ?? []).flatMap((c) => commandMitre(I(ctx), c.id))),
	},
	BeaconMeta: {
		source: (m: { sourceId?: string }, _, ctx) => (m.sourceId ? I(ctx).logById.get(m.sourceId) ?? null : null),
	},
	Command: {
		beacon: (c: CommandRow, _, ctx) => I(ctx).beaconById.get(c.beaconId),
		input: (c: CommandRow, _, ctx) => I(ctx).logById.get(c.inputId),
		output: (c: CommandRow, _, ctx) => I(ctx).outputByCommand.get(c.id) ?? [],
		operator: (c: CommandRow) => (c.operatorId ? { id: c.operatorId } : null),
		commandGroups: (c: CommandRow, _, ctx) => I(ctx).groupsByCommand.get(c.id) ?? [],
		commentsCount: (c: CommandRow, _, ctx) => commandCommentsCount(I(ctx), c.id),
		mitreTechniques: (c: CommandRow, _, ctx) => commandMitre(I(ctx), c.id),
	},
	LogEntry: {
		beacon: (l: LogRow, _, ctx) => (l.beaconId ? I(ctx).beaconById.get(l.beaconId) ?? null : null),
		command: (l: LogRow, _, ctx) => (l.commandId ? I(ctx).commandById.get(l.commandId) ?? null : null),
	},
	CommandGroup: {
		commandIds: (g: CommandGroupRow, _, ctx) =>
			g.commandIds.filter((id) => {
				const c = I(ctx).commandById.get(id);
				return !!c && commandVisible(I(ctx), c, ctx.hidden);
			}),
		commands: (g: CommandGroupRow, _, ctx) =>
			g.commandIds
				.map((id) => I(ctx).commandById.get(id))
				.filter((c): c is CommandRow => !!c && commandVisible(I(ctx), c, ctx.hidden)),
		annotations: (g: CommandGroupRow, _, ctx) => I(ctx).annotationsByGroup.get(g.id) ?? [],
		commentCount: (g: CommandGroupRow, _, ctx) => I(ctx).annotationsByGroup.get(g.id)?.length ?? 0,
	},
	Annotation: {
		tags: (a: AnnotationRow, _, ctx) => a.tagIds.map((id) => I(ctx).tagById.get(id)).filter(Boolean),
		tagCount: (a: AnnotationRow) => a.tagIds.length,
		commandIds: (a: AnnotationRow, _, ctx) =>
			(a.commandGroupId && I(ctx).groupById.get(a.commandGroupId)?.commandIds) || [],
		commandCount: (a: AnnotationRow, _, ctx) =>
			(a.commandGroupId && I(ctx).groupById.get(a.commandGroupId)?.commandIds.length) || 0,
		beaconIdFromFirstCommand: (a: AnnotationRow, _, ctx) => {
			const firstId = a.commandGroupId && I(ctx).groupById.get(a.commandGroupId)?.commandIds[0];
			return (firstId && I(ctx).commandById.get(firstId)?.beaconId) || '';
		},
	},
	Tag: {
		commandsCount: (t: TagRow, _, ctx) =>
			sum(I(ctx).annotationsByTag.get(t.id) ?? [], (a) => (a.commandGroupId && I(ctx).groupById.get(a.commandGroupId)?.commandIds.length) || 0),
		commentCount: (t: TagRow, _, ctx) => I(ctx).annotationsByTag.get(t.id)?.length ?? 0,
	},
	Link: {
		origin: (l: LinkRow, _, ctx) => beaconOf(I(ctx), l.originId) ?? null,
		destination: (l: LinkRow, _, ctx) => beaconOf(I(ctx), l.destinationId) ?? null,
		command: (l: LinkRow, _, ctx) => (l.commandId ? I(ctx).commandById.get(l.commandId) ?? null : null),
	},
	Operator: {
		name: (o: OperatorRow) => o.id,
		beaconIds: (o: OperatorRow, _, ctx) =>
			(I(ctx).beaconsByOperator.get(o.id) ?? []).filter((b) => ctx.hidden || !b.hidden).map((b) => b.id),
		logIds: (o: OperatorRow, _, ctx) =>
			(I(ctx).commandsByOperator.get(o.id) ?? []).filter((c) => commandVisible(I(ctx), c, ctx.hidden)).map((c) => c.id),
		commentsCount: (o: OperatorRow, _, ctx) =>
			sum(I(ctx).commandsByOperator.get(o.id) ?? [], (c) => commandCommentsCount(I(ctx), c.id)),
		startTime: (o: OperatorRow, _, ctx) => o.startTime ?? P(ctx).operators.find((x) => x.id === o.id)?.startTime ?? null,
		endTime: (o: OperatorRow, _, ctx) => o.endTime ?? P(ctx).operators.find((x) => x.id === o.id)?.endTime ?? null,
	},
};
