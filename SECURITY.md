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
against an `Origin` allowlist (the web app's own origin and any
`chrome-extension://` origin). The allowlist accepts any extension id rather
than one pinned id, because "Load unpacked" — the install path this project
documents — assigns a fresh, unpredictable extension id per machine with no
stable id to pin to; the Host check is what actually keeps the API
localhost-only, and the Origin check on top of it is CSRF defense, not an
identity check. Requests that fail either check are rejected with a 403
before reaching any route handler.

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
  OfferOS-managed artifacts (tailored résumé PDF, stored original résumé,
  confirmed cover-letter PDF), or to read a file from the page. File bytes
  are fetched only from the configured local web-app API base.

## Accepted risks (out of scope)

Some behaviors are deliberate trade-offs of a local-first, single-user tool
and are not treated as vulnerabilities on their own:

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
