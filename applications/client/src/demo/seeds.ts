import type { CampaignRow, Seed } from './db';
import gt from './seeds/gt.json';
import smalldata from './seeds/smalldata.json';
import synthetic from './seeds/synthetic.json';

/** Read-only datasets the demo campaigns are built from */
export const seeds: Record<string, Seed> = {
	synthetic: synthetic as unknown as Seed,
	gt: gt as unknown as Seed,
	smalldata: smalldata as unknown as Seed,
};

/** Campaigns that exist when the demo first loads (or after a reset) */
export const defaultCampaigns: CampaignRow[] = [
	{
		id: 'demo-halcyon',
		name: 'Halcyon Logistics Assessment',
		seedId: 'synthetic',
		creatorId: 'raven',
		lastOpenedById: 'raven',
		parserName: 'cobalt-strike-parser',
	},
	{
		id: 'demo-gt',
		name: 'Ground Truth Exercise',
		seedId: 'gt',
		creatorId: 'analyst01',
		lastOpenedById: 'analyst01',
		parserName: 'cobalt-strike-parser',
	},
	{
		id: 'demo-small',
		name: 'Small Data Set',
		seedId: 'smalldata',
		creatorId: 'analyst01',
		lastOpenedById: 'analyst01',
		parserName: 'cobalt-strike-parser',
	},
];

/**
 * Byte sizes of the original .redeye test databases these seeds were converted from.
 * The upload form drops the file name, so an uploaded fixture is recognized by its size.
 */
export const seedFileSizes: Record<number, string> = {
	540672: 'gt',
	303104: 'smalldata',
};

/** Dataset used when someone "uploads" a new campaign in the demo */
export const uploadSeedId = 'synthetic';
