/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
const { defineConfig } = require('cypress');
const tasks = require('./src/support/tasks');
const path = require('path');

module.exports = defineConfig({
	chromeWebSecurity: false,
	fixturesFolder: path.join(__dirname, 'src', 'fixtures'),
	experimentalModifyObstructiveThirdPartyCode: true,
	videosFolder: path.join(__dirname, '../../dist/applications/redeye-e2e/videos'),
	screenshotsFolder: path.join(__dirname, '../../dist/applications/redeye-e2e/screenshots'),
	failOnStatusCode: false,
	viewportWidth: 1920,
	viewportHeight: 1080,
	e2e: {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		setupNodeEvents(on, config) {
			tasks(on);
		},
		specPattern: '**/**/e2e/**/*.cy.js',
		supportFile: path.join(__dirname, 'src', 'support', 'e2e.js'),
		excludeSpecPattern: '*.skip.js',
		defaultCommandTimeout: 15000,
		// The demo keeps its data in sessionStorage, which Cypress would otherwise clear between tests.
		// The original server kept uploaded campaigns across tests in a spec, and the specs rely on that.
		testIsolation: false,
		trashAssetsBeforeRuns: true,
		baseUrl: 'http://localhost:3500',
	},
});
