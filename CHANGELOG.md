# Changelog

Notable changes to OfferOS, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/) once there is something to version.

OfferOS is pre-alpha and has never been released. Everything below is under
**Unreleased** and describes what exists on `main`. There are no upgrade paths
to honour yet and no published builds — expect the shape of things to move.

## [Unreleased]

### Added

**Autofill.** Fills Greenhouse, Lever, Ashby, iCIMS and Workday application
forms from a profile you own. Field classification is a pure, DOM-free library
(`packages/autofill`) so it can be tested without a browser; the extension only
executes what that library decides. Handles multi-page wizards, React-select
comboboxes, shadow DOM, radio and checkbox groups, and file uploads. Every
field it fills carries a plain-language reason for the value it chose.

**A workspace that owns the data.** The Next.js app holds applications,
résumés, answers and generated documents in a local SQLite file under
`~/.offeros`. The browser extension stores nothing; it asks the app for a
ticket, fills the form, and reports back per field.

**Résumé tailoring and cover letters.** Generate a tailored résumé or a cover
letter for a specific posting, preview the rendered PDF, then attach it — the
attach is a separate click, and the file is only reported as attached once its
presence on the page is verified. LaTeX templates are supported; bring your own
`.tex` and mark the body region, or use the built-in one.

**Job analysis and fit.** Summarises a posting, lists gaps against your
profile, and scores fit from deterministic skill overlap. The score is advisory
and never blocks an application.

**Answer bank with guardrails.** Reuses answers you have approved before. Three
classes of question are refused for AI generation rather than answered:
identity and demographics, questions with a factual right answer you alone know
(work authorisation, sponsorship, citizenship, salary), and policy
acknowledgements. Policy questions the app did fill are listed afterwards for
you to check.

**Bring your own model.** Anthropic or OpenAI, with your key. Keys are stored
locally and never sent to the browser. System prompts are editable per task.

**Campaigns.** Group applications into named batches — select jobs on the
list, move them into a campaign, and run the whole batch through the same
queue and the same gates as anything else. Each campaign shows how far the
batch is: submitted, in progress, waiting on you. Deleting a campaign only
removes the grouping; the applications stay.

**A verification lab for the fill engine.** Captured forms can be replayed
offline through the exact same engine that fills live pages. Three synthetic
test personas with deliberately distinguishable values prove every filled value
came from the active profile — a value carrying another persona's material is
flagged as cross-contamination automatically. Captures that lost information
(a dropdown without its choices, a question without its text) are refused at
the door instead of quietly replaying against a form that never existed. When
a real fill leaves problems behind, the extension photographs those fields and
stores the screenshots locally beside the database, so a later review can
compare what the engine reported against what the page actually showed.

**An agent you can ask about your search.** A conversational agent, on `/agent`
and inside each application, answers questions about your applications in plain
language — "which of these are stuck, and why?", "what got filled in here?" — by
reading the real records (fill reports, decision traces, your saved answers, form
memory) and showing the steps that produced each answer, not just the answer. It
works in a loop of small verified tool calls: it can also make gated changes
(save an answer, update an application's status, tailor a résumé), at most two
per turn, each verifying itself by re-reading what it wrote. It cannot mark an
application submitted unless your own message says you submitted it — that check
reads your words, not a model-set flag, and no text scraped from a web page can
talk past it.

**A record of what the forms actually asked.** Each completed fill stores the
questions it met, identified by their content rather than by any page-specific
id, so the same question on two different postings is recognised as one
question. Fills that went genuinely wrong — a value the page refused, a required
question never seen before, a question failing again on another application, a
new form that broadly did not fill — are recorded separately from fills where a
guard simply did its job. The agent page shows how often each happens. No model
is involved in any of it; every figure is a count.

### Security and privacy

- The local API refuses any request whose `Host` is not loopback, and checks
  `Origin` against an allowlist on every mutating request.
- The database and its directory are created owner-only; résumés live beside it
  on disk, not in a cloud.
- Text the app did not author — page text scraped from a posting, and the text
  extracted from an uploaded résumé — is fenced before it reaches a model, so a
  posting or a document cannot inject instructions into a prompt.
- Nothing is submitted on your behalf. The submit step waits for you.

### Notable fixes

- **Schema changes now reach long-lived processes.** Database DDL ran once when
  a connection was opened, and the connection was cached for the life of the
  process — so a running app could serve new code over a connection that had
  never seen the new schema, and fail with `no such table`. The schema is now
  re-applied whenever the connection is older than the build, identified by a
  fingerprint derived from the schema itself.
- **Wrong-tenant claims.** The extension could claim a fill ticket belonging to
  a different posting when two tabs looked alike; tickets are now bound to a
  tab explicitly.
- **Silent false attachments.** A file upload that did not actually land could
  be reported as filled. Attachment is verified against the page before it is
  recorded.
- **Recovery from the wrong page.** Landing on a posting's description instead
  of its form, or on a job-board index, is detected and navigated from, with a
  per-tab attempt budget so it cannot loop.

### Known gaps

- No released build. Run it from source.
- The local app is started as a development server. That is fine for
  development and is not yet a supportable way to run it day to day.
- The deterministic pipeline drives its own generation steps; the conversational
  agent sits above it (triage, diagnosis, small gated changes) rather than
  running the pipeline itself. This is by design, not a gap — but the two share
  a "task" concept, and only the agent's tools carry the verify-and-trace
  contract.
- The auto-submit preference is recorded and deliberately not implemented. The
  submit gate always stops for you.
- Your data lives in one local SQLite file. You can export a portable backup
  from Settings → Data; restoring it onto a new machine is a documented manual
  step, not yet a one-click import.
