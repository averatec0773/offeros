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

**An application is a record, not a workflow.** Each job gets one page that
says each thing once: the posting, one card for the form (the button before you
fill, the count after, and anything needing you pinned on top, with the
field-by-field detail and what went wrong folded away), the newest few timeline
entries with the rest a click away, and everything you have to send (a tailored résumé and a cover
letter — generate, revise, accept). Its state is yours to set: saved, applying,
applied, interview, offer, rejected, archived. There are no steps to approve
and nothing to start; the generation still runs, it just no longer asks
permission at each turn.

**The job description, in two layers that cost different things.** The posting
itself is always there, collapsed to a dozen lines with the meta you care about
(pay first), and the skills you already have are highlighted in the employer's
own text — no upload, no wait, no call to your model, because your profile is
already on your machine. The reading is the part that costs: one button, one
call on your key, stored so you pay for it once, and shown as a peer tab so it
never buries the source. With no description saved, two free ways to get one:
paste it, or let the posting check fetch it.

**One mark on everything that spends.** Every button that calls your AI
provider carries the same glyph and the same tooltip; every button that does
not carries neither. Checking a posting, filling a form, changing a status are
unmarked because they are free. One glance says which of the things in front of
you is the expensive one.

**Job reconnaissance.** One click asks the posting two questions: are you still
up, and what will your form ask? On Greenhouse the answer comes from the
platform's own job-board API — every question, its type, and whether it is
required — so the page can tell you "10 required questions, 8 already answered"
and name the two it cannot. Entirely deterministic: status codes and the
platform's own words, no model anywhere in it. When a site cannot be read it
says "could not tell" rather than guessing, because a wrong "closed" costs you
a job you could still have applied to.

**Add a job by pasting its link.** On a supported board the title, company and
description come from the board. Anywhere else you get a minimal record with an
editable title, because a guessed company name is worse than a blank one. The
same posting twice opens the one you already have.

**Bring your own model.** Anthropic or OpenAI, with your key. Keys are stored
locally and never sent to the browser. System prompts are editable per task.

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
language — "which of these are stuck, and why?", "what got filled in here?",
"what has happened with this one?" — by reading the real records (fill reports,
decision traces, the application's own timeline, your saved answers, form
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
- **A toolbar button that did nothing.** The extension's side panel was enabled
  only on supported application forms, so clicking the icon anywhere else was a
  silent no-op with nothing to explain it. The panel now opens on any page: on
  an application form it drives the fill, and everywhere else it shows what is
  waiting on you and opens the web app.
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
- Generation runs as deterministic, grounded steps; the conversational agent
  sits above them (triage, diagnosis, small gated changes) rather than driving
  them. This is by design, not a gap — but only the agent's tools carry the
  verify-and-trace contract.
- Reconnaissance reads Greenhouse postings in full. Other boards get the
  is-it-still-up half only; their question lists wait for a real fill.
- The auto-submit preference is recorded and deliberately not implemented.
  Submitting is always yours.
- Your data lives in one local SQLite file. You can export a portable backup
  from Settings → Data; restoring it onto a new machine is a documented manual
  step, not yet a one-click import.
