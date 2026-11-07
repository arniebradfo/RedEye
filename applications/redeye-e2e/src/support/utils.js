/// <reference types="cypress" />

// The demo has no server: GraphQL runs inside the app window, so run test queries there too.
const demoRequest = (query, variables) =>
	cy
		.window({ log: false })
		.then((win) => {
			if (!win.__redeyeDemo) throw new Error('RedEye demo backend not found on window; visit the app first');
			return win.__redeyeDemo.executeDemoQuery(query, variables);
		})
		.then((data) => {
			const res = { status: 200, body: { data } };
			expect(res.status).to.eq(200);
			return res;
		});

export const graphqlRequest = (query, variables) => demoRequest(query, variables);

export const mutRequest = (mutation, variables) => demoRequest(mutation, variables);
