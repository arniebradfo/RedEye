/** Demo-only switches, remembered for the browser session */
const BLUE_TEAM_KEY = 'redeye-demo-blue-team';

const read = (key: string) => {
	try {
		return window.sessionStorage.getItem(key);
	} catch {
		return null;
	}
};

export const demoSettings = {
	get blueTeam() {
		return read(BLUE_TEAM_KEY) === 'true';
	},
	set blueTeam(value: boolean) {
		try {
			window.sessionStorage.setItem(BLUE_TEAM_KEY, String(value));
		} catch {
			// ignore
		}
	},
};
