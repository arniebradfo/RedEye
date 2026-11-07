# **RedEye** Demo: Red Team C2 Log Visualization

This is a static, browser-only demo of [RedEye](https://github.com/cisagov/RedEye), a tool built for CISA to visualize and annotate Cobalt Strike red team campaigns. The original app was an Electron/Node server with a SQLite database per campaign. This fork keeps the original React client and replaces the server with an in-browser fake, so the whole thing can be hosted on GitHub Pages.

It runs on fictional and test data only. Nothing you do in the demo leaves your browser tab: comments, renames, hidden beacons and new campaigns are kept in `sessionStorage` and disappear when the tab closes.

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

## License

RedEye was developed by PNNL for CISA. See [LICENSE](LICENSE) and [DISCLAIMER](DISCLAIMER).
