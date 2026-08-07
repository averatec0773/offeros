// Shadow-DOM-piercing DOM queries. Modern ATS widgets (notably Workday's SAP
// UI5 skill picker) render their real <input> and their suggestion options
// inside shadow roots, where a plain document.querySelector cannot reach them.
// deepQuery / deepQueryAll walk open shadow roots so those elements are found.

function walk(root: ParentNode, selector: string, all: boolean, out: Element[]): boolean {
  // When `root` is itself a shadow host, its own shadow root holds the matches
  // (e.g. deepQuery(skillHost, "input")). Descend into it first.
  const ownShadow = (root as Element).shadowRoot;
  if (ownShadow && walk(ownShadow, selector, all, out) && !all) return true;

  const direct = root.querySelectorAll(selector);
  for (const el of Array.from(direct)) {
    out.push(el);
    if (!all) return true;
  }
  // Descend into every open shadow root under this root.
  const hosts = root.querySelectorAll("*");
  for (const host of Array.from(hosts)) {
    const shadow = (host as Element).shadowRoot;
    if (shadow && walk(shadow, selector, all, out) && !all) return true;
  }
  return out.length > 0;
}

export function deepQuery(root: ParentNode, selector: string): Element | null {
  const out: Element[] = [];
  walk(root, selector, false, out);
  return out[0] ?? null;
}

export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [];
  walk(root, selector, true, out);
  return out;
}
