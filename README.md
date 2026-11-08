# **RedEye** Demo: Red Team C2 Log Visualization

This is a static, browser-only demo of [RedEye](https://github.com/cisagov/RedEye), a tool built for CISA to visualize and annotate Cobalt Strike red team campaigns. The original app was an Electron/Node server with a SQLite database per campaign. This fork keeps the original React client and replaces the server with an in-browser fake, so the whole thing can be hosted on GitHub Pages.

It runs on fictional data, test data, and one set of real lab logs credited below. Nothing you do in the demo leaves your browser tab: comments, renames, hidden beacons and new campaigns are kept in `sessionStorage` and disappear when the tab closes.

## How it works

- **Client:** [applications/client](applications/client), the original RedEye UI (React, Blueprint, MobX Keystone, D3).
- **Graph and styles:** [packages/graph](packages/graph) and [packages/ui-styles](packages/ui-styles), unchanged.
- **Fake server:** [applications/client/src/demo](applications/client/src/demo).
  - `executor.ts` runs the original GraphQL schema with [graphql-js](https://github.com/graphql/graphql-js) in the browser. The generated mk-gql store talks to it in place of an HTTP client.
  - `resolvers.ts` ports the server's type-graphql resolvers from MikroORM queries to plain array logic.
  - `db.ts` loads read-only seed datasets and keeps editable tables per campaign in `sessionStorage`.
  - `fetch-shim.ts` answers the few REST calls the client makes (login, app metadata, uploads, export).
- **Datasets:** [applications/client/src/demo/seeds](applications/client/src/demo/seeds).
  - `synthetic.json` comes from [tools/generate-synthetic.mjs](tools/generate-synthetic.mjs): a three-day fictional intrusion into "Halcyon Logistics".
  - `redelk.json` holds real Cobalt Strike team server logs from the lab in Outflank's [RedELK Part 3](https://outflank.nl/blog/2020/04/07/redelk-part-3-achieving-operational-oversight/) blog post. They came from [RedELK's example data](https://github.com/outflanknl/RedELK/tree/master/example-data-and-configs/ExampleData) and were parsed with the original RedEye Cobalt Strike parser from `develop`. See [Data credits](#data-credits).
  - `gt.json` and `smalldata.json` were converted from the original e2e test databases with [tools/fixture-to-seed.py](tools/fixture-to-seed.py).

The original server, parsers, migrations and Electron packaging have been removed. They are still on the `develop` branch history if you need them.

## Development

Requires Node 24 (see `.nvmrc`) and Yarn (bundled in `.yarn/releases`).

```sh
yarn install
yarn start        # dev server on http://localhost:3500
yarn typecheck
yarn build        # static site in applications/client/dist
```

Regenerate the synthetic dataset:

```sh
node tools/generate-synthetic.mjs
```

## Tests

The original Cypress suite still runs against the demo. Its GraphQL helpers call the in-browser executor instead of a server.

```sh
yarn start                          # in one terminal
yarn cy:run                         # or yarn cy:open
```

If you launch Cypress from a VS Code terminal, run `unset ELECTRON_RUN_AS_NODE` first.

## Deploying

[.github/workflows/pages.yml](.github/workflows/pages.yml) builds the site and deploys it to GitHub Pages on every push to `develop` or `demo`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Data credits

The "Outflank RedELK Lab" campaign uses the `c2server1` and `c2server2` Cobalt Strike logs from [outflanknl/RedELK](https://github.com/outflanknl/RedELK), Copyright (c) 2018 Outflank B.V., under the BSD 3-Clause license. A copy of that license is in [redelk.LICENSE](applications/client/src/demo/seeds/redelk.LICENSE). The logs, screenshots and lab credentials in them come from Outflank's demo environment and are unchanged apart from parsing. Thanks to Outflank for publishing them.

To rebuild that seed, parse the two `logs` folders with the Cobalt Strike parser from `develop`, then convert the result:

```sh
python3 tools/fixture-to-seed.py test.sqlite redelk applications/client/src/demo/seeds/redelk.json applications/client/public/demo-images
```

The parser on `develop` needed two small fixes to run on these logs. Its `--folders` option has to collect an array, and upload indicator lines (`file: <md5> <size> bytes <name>`) have to be parsed with a regex. It also calls itself as `cobalt-strike-parser`, so that name has to be on your `PATH`.

## License

RedEye was developed by PNNL for CISA. See [LICENSE](LICENSE) and [DISCLAIMER](DISCLAIMER).
