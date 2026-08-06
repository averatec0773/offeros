# OfferOS

Local-first, open-source AI job-application copilot for the North American
market. `apps/web` (Next.js) is **the product**: it owns your data in a local
SQLite database and is where you build your profile, track applications, and run
the AI workspace. `apps/extension` (a Chrome **Side Panel**) is the **fill arm**:
on a supported ATS page it fills the form for you from the web app's data. You
always review and submit every application yourself — OfferOS never submits for
you and never uploads page HTML anywhere. The only files it ever attaches to a
form are your own: the tailored résumé PDF, your stored original résumé, or the
confirmed cover-letter PDF. It never reads files from the page.

Status: pre-alpha.

## How it works

1. In the web app, you build your profile once (upload a résumé to auto-fill it)
   and add jobs you want to apply to.
2. Working an application in the agent workspace tailors your résumé, drafts a
   cover letter, and analyzes fit against the posting — all grounded in your own
   facts, with your own LLM key, server-side.
3. When you're ready to apply, the web app hands the filled-in answers to the
   extension as a **fill task**. You open the **Side Panel** on the ATS apply
   page; it claims the task, fills the form, and reports each field's status back
   to the workspace.
4. You review the page and **submit it yourself**.

The AI runs in the web app (server-side, with your key). The extension is a thin
client — no local database, no AI of its own — it just drives the page.

## Quickstart (web app)

```bash
npm install
npm run dev:web     # http://localhost:3000
```

On first run, open **Settings → AI** in the web app to pick a provider and paste
your API key — that's it, no restart and no dotfiles required. If you'd rather
not paste a key in the UI, `apps/web/.env.local` (`ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`, see `apps/web/.env.example`) works as an optional fallback.
Either way, tune each AI task's model/prompt in **Settings**. Your data is
stored locally in SQLite at `~/.offeros/offeros.db` (override with
`OFFEROS_DB_PATH`), including any key you save in Settings; imported résumé
files live under `~/.offeros/resumes/`. No account, no cloud — everything is on
disk on your machine, and your key is only ever sent to the provider you chose.

## Features (web app)

- **Application pipeline** — a hub of your applications with status tabs, an
  autosaved job description, notes, and a fit badge per role.
- **Profile & onboarding** — upload a résumé to auto-populate your profile
  (personal info, education, experience, skills, an answer bank, and standard
  EEO self-identification), or fill it in by hand. Manage multiple résumés and
  pick one per application.
- **Agent workspace** — a grounded pipeline per application: résumé tailoring →
  JD analysis (with a gaps report) → conditional cover-letter generation, with
  conversational gates and real old-vs-new diffs on every tweak.
- **Fit analysis** — an honest read of what your profile already covers vs. gaps,
  with sub-scores and aligned/missing skills (advisory, never blocking).
- **Cover-letter templates & PDF export** — import your own `.tex` template
  (previewed in-app) or use the built-in one; export a compiled PDF.
- **Prompt Studio** — override each AI task's system prompt and model.

## One-click autofill (extension)

Supported ATS: **Greenhouse** (validated on real forms) · **Lever · Ashby ·
iCIMS · Workday** (generic fill engine + per-site routing; hardening ongoing).

The extension is a WXT + React + TypeScript MV3 **Side Panel**. It's a thin client
of the web app's local API — no local store, no AI, no third-party sync.

```bash
npm install
npm run build -w @offeros/extension   # → apps/extension/.output/chrome-mv3/
```

1. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked** →
   select `apps/extension/.output/chrome-mv3/`.
2. Make sure the web app is running (`npm run dev:web`). The side panel talks to
   `http://localhost:3000` by default (editable in the panel).
3. Open a supported application page and click the OfferOS toolbar icon to open
   the **Side Panel**.
4. The panel shows a per-field readiness list (ready / needs your answer / not
   recognized) and a **Fill** button. Click it, then **review the page and submit
   it yourself**. Fields the agent couldn't answer are reported back to the
   workspace for you to resolve.

## Privacy & safety invariants

- **Never auto-submits** — you submit every application.
- **Only ever attaches your own OfferOS-managed files** (the tailored résumé
  PDF, your stored original résumé, or the confirmed cover-letter PDF) to file
  inputs — it never reads files from the page — and **never uploads page
  HTML** anywhere; field classification and filling run on-device.
- **Keys stay server-side** — your LLM provider key lives only in the web app's
  environment; the browser extension never sees it.
- **Local-first** — all your data is on your machine, in SQLite.

## Development

```bash
npm run dev:web     # web app dev server → http://localhost:3000
npm run dev         # extension dev build with HMR
npm run compile     # extension type-check (tsc --noEmit)
npm run typecheck   # web + packages + extension type-check
npm test            # root Vitest (packages + apps/web) + extension Vitest
npm run test:ext    # extension Vitest only
npm run e2e -w @offeros/extension   # headed E2E: real Chromium, built extension
```

Requires Node 24+. The repo is an npm-workspaces monorepo: `apps/web` (the
product), `apps/extension` (the Side Panel fill arm), and `packages/*` — `core`
(domain schemas), `llm` (IO-free LLM layer), `autofill` (pure, DOM-free fill
engine, shared by both apps), and `pdf` (PDF text extraction).

## License

Apache-2.0.
