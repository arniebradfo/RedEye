import { Button, FormGroup, Switch } from '@blueprintjs/core';
import { Txt } from '@redeye/ui-styles';
import { useState } from 'react';
import { db } from './db';
import { demoSettings } from './settings';

/** Demo-only controls shown in the Settings dialog */
export const DemoSettings = () => {
	const [blueTeam, setBlueTeam] = useState(demoSettings.blueTeam);
	return (
		<FormGroup
			label="Demo"
			helperText={
				<Txt small muted>
					This demo runs entirely in your browser on fictional data. Changes last until you close this tab.
				</Txt>
			}
		>
			<Switch
				checked={blueTeam}
				onChange={(event) => {
					const value = event.currentTarget.checked;
					setBlueTeam(value);
					demoSettings.blueTeam = value;
					// app metadata is read once at startup, so reload into the other mode
					window.location.reload();
				}}
				label="Blue Team mode (read-only review)"
			/>
			<Button
				text="Reset demo data"
				icon="reset"
				onClick={() => {
					db.reset();
					window.location.hash = '#/campaigns/all';
					window.location.reload();
				}}
			/>
		</FormGroup>
	);
};
