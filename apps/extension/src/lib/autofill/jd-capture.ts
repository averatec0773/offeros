export interface JdCaptureResult {
  text: string;
  source: "jsonld" | "dom" | "none";
}

const stripHtml = (html: string): string => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
};

interface JsonLdNode {
  "@type"?: string | string[];
  title?: unknown;
  description?: unknown;
  hiringOrganization?: { name?: unknown };
}

function fromJsonLd(root: ParentNode): string | null {
  const scripts = Array.from(root.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const nodes: JsonLdNode[] = Array.isArray(parsed) ? (parsed as JsonLdNode[]) : [parsed as JsonLdNode];
    for (const node of nodes) {
      const type = node["@type"];
      const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (!isJob || typeof node.description !== "string") continue;
      const title = typeof node.title === "string" ? node.title : "";
      const org = typeof node.hiringOrganization?.name === "string" ? node.hiringOrganization.name : "";
      return [title, org, stripHtml(node.description)].filter((s) => s).join("\n");
    }
  }
  return null;
}

function fromDom(root: ParentNode): string {
  const main = root.querySelector("main") ?? root.querySelector("body") ?? root;
  return ((main as HTMLElement).textContent ?? "").replace(/\s+/g, " ").trim();
}

export function captureJd(root: ParentNode, minChars = 120): JdCaptureResult {
  const ld = fromJsonLd(root);
  if (ld) return { text: ld, source: "jsonld" };
  const dom = fromDom(root);
  if (dom.length >= minChars) return { text: dom.slice(0, 12000), source: "dom" };
  return { text: "", source: "none" };
}
