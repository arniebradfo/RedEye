import type { GraphQLObjectType } from 'graphql';
import { buildSchema, graphql } from 'graphql';
import type { DemoContext } from './resolvers';
import { Mutation, Query, Types } from './resolvers';
import sdl from './schema.graphql?raw';

const schema = buildSchema(sdl);

const attach = (typeName: string, resolvers: Record<string, (...args: any[]) => unknown>, root = false) => {
	const type = schema.getType(typeName) as GraphQLObjectType | undefined;
	if (!type) throw new Error(`RedEye demo: unknown GraphQL type ${typeName}`);
	const fields = type.getFields();
	for (const [name, fn] of Object.entries(resolvers)) {
		if (!fields[name]) throw new Error(`RedEye demo: unknown field ${typeName}.${name}`);
		fields[name].resolve = root
			? (_source, args, ctx) => (fn as (a: unknown, c: unknown) => unknown)(args, ctx)
			: (source, args, ctx) => fn(source, args, ctx);
	}
};

attach('Query', Query, true);
attach('Mutation', Mutation, true);
for (const [typeName, resolvers] of Object.entries(Types)) attach(typeName, resolvers);

/** Simulated network latency so loading states still read as a real app */
const LATENCY_MS = 60;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeDemoQuery(query: string, variables?: Record<string, unknown>) {
	await wait(LATENCY_MS);
	const contextValue: DemoContext = { hidden: false };
	const result = await graphql({ schema, source: query, variableValues: variables, contextValue });
	if (result.errors?.length) {
		// eslint-disable-next-line no-console
		console.error('RedEye demo GraphQL error', result.errors, query, variables);
		throw new Error(result.errors.map((e) => e.message).join('\n'));
	}
	// graphql-js returns null-prototype objects; hand the store plain JSON like a real server would
	return JSON.parse(JSON.stringify(result.data));
}

/** Drop-in replacement for the mk-gql/graphql-request HTTP client */
export const demoGqlClient = {
	request: (query: string, variables?: Record<string, unknown>) => executeDemoQuery(query, variables),
};
