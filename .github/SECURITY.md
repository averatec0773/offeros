# Security Policy

## Reporting a vulnerability

Report vulnerabilities using GitHub's private vulnerability reporting: open the
**Security** tab on this repository and click **Report a vulnerability**. This
opens a private advisory visible only to maintainers — please don't use email
or a public issue for anything security-sensitive.

## Supported deployment

OfferOS is designed to run as a **localhost-only, single-user** server on your
own machine. There is no multi-tenant or hosted deployment, and the API is
intentionally unauthenticated — it relies on the server only ever answering
the person sitting at that machine. Every request — page routes as well as
`/api/v1` (the middleware matcher covers both) — is checked against a
loopback `Host` header, and mutating requests are additionally checked
against an `Origin` allowlist (the web app's own origin and, subject to the
setting below, `chrome-extension://` origins).

**Extension-origin allowlist.** By default any `chrome-extension://` origin is
accepted, because a side-loaded pre-alpha extension has no stable published id
to pin. Set `OFFEROS_ALLOWED_EXTENSION_IDS` (comma-separated ids) to restrict
access to your own extension — when set, only those ids pass, and the check
applies to reads as well as writes, so another installed extension cannot read
your data through a "safe" GET either. Give the extension a deterministic id by
committing WXT's manifest `key` (via `VITE_CHROME_EXT_KEY` in
`apps/extension/wxt.config.ts`) or by publishing it, then allowlist that id.

The Host check is what keeps the API localhost-only regardless of the above.
Requests that fail any check are rejected with a 403 before reaching any route
handler. A request with **no** `Origin` (curl, scripts, non-browser local
clients) is allowed on mutating methods by design — see Accepted risks below.

Running an OfferOS instance reachable from outside localhost (reverse proxy,
port forwarding, `0.0.0.0` binding) is outside the supported deployment model
and outside this policy's scope.

## Scope

We're interested in reports that show a concrete way to break the
localhost-only, single-user trust model, including:

- Bypassing the loopback `Host` check or the `Origin` allowlist to reach the
  API from an unauthorized origin.
- Any path that leaks a stored LLM provider API key — into an HTTP response,
  a log line, or a spawned subprocess's environment.
- Prompt injection carried through scraped ATS page text that causes the
  agent to take an action beyond what the user's own data or instructions
  authorize.
- Path traversal or arbitrary file write/read through résumé or template
  uploads.
- Any path that causes the extension to attach a file other than the three
  OfferOS-managed artifacts it currently handles (tailored résumé PDF, stored
  original résumé, cover-letter PDF), or to read a file from the page. File
  bytes are fetched only from the configured local web-app API base. (This
  describes the current implementation — if the set of managed files grows,
  this section moves with it.)
- **The extension asks for access to all sites (`<all_urls>`), and Chrome says
  so at install.** This was a five-platform allowlist plus a per-site grant the
  user gave from the panel; it was reverted on 2026-08-12 because application
  forms live on companies' own careers pages, so the narrow list made the
  ordinary case the broken case, and the grant machinery produced repeated
  failures without ever delivering the permission prompt it existed for. The
  broad ask is stated rather than worked around, here and in
  `apps/extension/wxt.config.ts`.

  What that access is and is not used for:

  - the engine is injected automatically on the five supported ATS platforms,
    and on any other page only while the side panel is open on that page;
  - it reads the form and the posting on that page, and writes values you have
    saved. It does not read pages you are not applying on, and it never
    submits a form;
  - everything it reads goes only to the local web app over `http://localhost`.
    There is no OfferOS server. The loopback `Host` check and the `Origin`
    allowlist on the web-app side remain the enforcement boundary, unchanged by
    this;
  - the extension takes no screenshots. It used to attempt one per fill
    incident as a record; that feature was removed on 2026-08-13, along with
    the `activeTab` permission that was its only user.

- Panel-initiated writes (`POST /api/v1/agent/fill/instant`, targeted
  tailor/cover-letter runs) go through the same request guard and envelope as
  every other mutating route; they create/modify only local rows.

## Accepted risks (out of scope)

Some behaviors are deliberate trade-offs of a local-first, single-user tool
and are not treated as vulnerabilities on their own:

- **Requests with no `Origin` header are allowed on mutating methods.** The
  `Origin` allowlist defends against a web page in your browser making requests
  to the local server; a browser always sends `Origin` on such a request. curl,
  a shell script, or any other non-browser local client sends none, and is let
  through deliberately. Rejecting them would buy nothing: code already running
  on your machine is outside the trust boundary, and could send an `Origin`
  header of its choosing anyway. The loopback `Host` check still applies.
- **Any process running as you can change your data.** There is no
  authentication between you and the local API, and none between a local
  process and `~/.offeros`. Anything running under your user account can read
  and modify your applications, answers, résumés and settings — through the API
  or straight through the SQLite file. That is the single-user, local-first
  model, not a gap in it: the boundary this app defends is your machine, and
  inside it there is nothing further to separate.
- **API keys are stored in plaintext** in your local `~/.offeros` directory
  (the directory is `0700`, the database file `0600`, applied best-effort —
  these Unix permission bits only take effect on filesystems that support
  POSIX modes). The key never leaves your machine except in requests to the
  LLM provider you configured. If someone has access to your local user
  account or filesystem, they already have access to everything else in
  `~/.offeros`.
- **User-authored templates render unsanitized.** A cover-letter template you
  import (`.tex`, or the built-in HTML template) is compiled/rendered on your
  own machine, by design — the same trust boundary as running your own
  document through your own toolchain. We do still run template rendering
  (pdflatex, headless Chromium) with a minimal subprocess environment, so a
  malicious template never sees your provider key or other environment
  secrets, even though it executes with your local trust. That said, the
  built-in HTML path renders in a network-capable headless browser, so a
  template you don't trust can still cause the document it renders to send
  its contents to a remote host (e.g. a remote-loaded image or script) —
  don't import templates you don't trust.
