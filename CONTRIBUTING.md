# Contributing to OfferOS

## Prerequisites

- A recent Node LTS (the project currently develops against Node 24+; see
  `README.md`).
- `npm ci` to install dependencies exactly as locked.

```bash
npm ci
```

## Running it locally

```bash
npm run dev:web     # web app dev server → http://localhost:3000
npm run dev         # extension dev build with HMR
```

The web app is the product and owns your data; the extension is a thin
client that talks to it over `http://localhost:3000` by default.

## Monorepo map

- `apps/web` — the product: the Next.js app that owns your data and runs the
  AI pipeline.
- `apps/extension` — the fill arm: a Chrome Side Panel that drives real ATS
  pages from the web app's data.
- `packages/*` — IO-free shared layers (`core` domain schemas, `llm` provider
  layer, `autofill` pure fill engine, `pdf` text extraction) imported by both
  apps.

## Gate suite

Before opening a PR, make sure all of these pass:

```bash
npm run lint
npm run format:check
npm run typecheck
npx vitest run
npm run test:ext
npm run build -w @offeros/extension
cd apps/web && npm run build
```

A handful of tests are gated on a local Chromium install and are skipped
otherwise; run `npx playwright install chromium` once to unlock them.

If your change touches the extension's fill engine, content-script messaging,
or the side panel, also run the headed end-to-end harness once locally
(`npm run e2e -w @offeros/extension`) — it drives the built extension against
a real Chromium instance over the actual `runtime.onMessage` bus. It's not in
the automated CI gate above: it requires a headed browser, and it currently
has no built-in pass/fail assertions (it prints one `E2E <check>: <value>`
line per check), so treat a run as a manual gate — read the output and
confirm every line looks right before opening the PR.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
`fix:`, `docs:`, `refactor:`, `test:`, `chore:`, …) for commit subjects.

## Pull requests

- All gates above must be green.
- Behavior changes need accompanying tests — don't rely on manual testing
  alone.
- Follow the **web-first rule**: primary features live in the web app
  (`apps/web`). The extension is execution only — it fills forms from data
  the web app already computed, and should not grow its own data store, AI
  calls, or standalone features.
