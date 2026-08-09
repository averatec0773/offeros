export interface JdCaptureResult {
  text: string;
  source: "jsonld" | "dom" | "none";
  /** JSON-LD only — sanitized (control chars/newlines flattened, trimmed, capped at 200 chars). Undefined on DOM fallback. */
  title?: string;
  /** JSON-LD only — same sanitization as `title`. Undefined on DOM fallback. */
  company?: string;
}

const stripHtml = (html: string): string => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
};

// Belt for the structured title/company that flow into prompts as short labels
// and into the panel's confirm-card UI: flatten control chars/newlines to a
// single space, trim, and cap length. Token-level neutralization (defanging a
// literal "</untrusted-page-text>") is the LLM tasks' job server-side, not this.
// eslint-disable-next-line no-control-regex -- stripping C0 control characters from scraped page text is the point
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]+/g;
const MAX_LABEL_LEN = 200;

export function sanitizeLabel(s: string): string {
  return s.replace(CONTROL_CHARS_RE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LEN);
}

interface JsonLdNode {
  "@type"?: string | string[];
  title?: unknown;
  description?: unknown;
  hiringOrganization?: { name?: unknown };
}

interface JsonLdCapture {
  text: string;
  title?: string;
  company?: string;
}

function fromJsonLd(root: ParentNode): JsonLdCapture | null {
  const scripts = Array.from(root.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const nodes: JsonLdNode[] = Array.isArray(parsed)
      ? (parsed as JsonLdNode[])
      : [parsed as JsonLdNode];
    for (const node of nodes) {
      const type = node["@type"];
      const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (!isJob || typeof node.description !== "string") continue;
      const title = typeof node.title === "string" ? node.title : "";
      const org =
        typeof node.hiringOrganization?.name === "string" ? node.hiringOrganization.name : "";
      const text = [title, org, stripHtml(node.description)].filter((s) => s).join("\n");
      const sanitizedTitle = sanitizeLabel(title);
      const sanitizedCompany = sanitizeLabel(org);
      return {
        text,
        title: sanitizedTitle || undefined,
        company: sanitizedCompany || undefined,
      };
    }
  }
  return null;
}

function fromDom(root: ParentNode): string {
  const main = root.querySelector("main") ?? root.querySelector("body") ?? root;
  return ((main as HTMLElement).textContent ?? "").replace(/\s+/g, " ").trim();
}

const MAX_JD_LEN = 12000;

export function captureJd(root: ParentNode, minChars = 120): JdCaptureResult {
  const ld = fromJsonLd(root);
  if (ld)
    return {
      text: ld.text.slice(0, MAX_JD_LEN),
      source: "jsonld",
      title: ld.title,
      company: ld.company,
    };
  const dom = fromDom(root);
  if (dom.length >= minChars) return { text: dom.slice(0, MAX_JD_LEN), source: "dom" };
  return { text: "", source: "none" };
}
