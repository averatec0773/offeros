"use client";

import type { Personal } from "@offeros/core";
import { LabeledInput } from "./fields";

/**
 * Controlled editor for `profileSchema.personal`. Pure: it owns no persistence —
 * the parent supplies `value` and receives every edit through `onChange`, so the
 * same component backs both the /profile page and Task 6's onboarding review.
 */
export function PersonalForm({
  value,
  onChange,
}: {
  value: Personal;
  onChange: (value: Personal) => void;
}) {
  function set<K extends keyof Personal>(key: K, next: Personal[K]) {
    onChange({ ...value, [key]: next });
  }

  function setLink(key: keyof NonNullable<Personal["links"]>, next: string) {
    onChange({ ...value, links: { ...value.links, [key]: next } });
  }

  const links = value.links ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LabeledInput label="Full name" value={value.name} onChange={(v) => set("name", v)} />
        <LabeledInput
          label="Email"
          type="email"
          value={value.email}
          onChange={(v) => set("email", v)}
        />
        <LabeledInput label="Phone" value={value.phone} onChange={(v) => set("phone", v)} />
        <LabeledInput
          label="Address"
          value={value.address ?? ""}
          onChange={(v) => set("address", v)}
        />
        <LabeledInput label="City" value={value.city ?? ""} onChange={(v) => set("city", v)} />
        <LabeledInput
          label="State / Region"
          value={value.state ?? ""}
          onChange={(v) => set("state", v)}
        />
        <LabeledInput
          label="Country"
          value={value.country ?? ""}
          onChange={(v) => set("country", v)}
        />
        <LabeledInput
          label="Postal code"
          value={value.postalCode ?? ""}
          onChange={(v) => set("postalCode", v)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <LabeledInput
          label="LinkedIn"
          value={links.linkedin ?? ""}
          onChange={(v) => setLink("linkedin", v)}
          placeholder="linkedin.com/in/…"
        />
        <LabeledInput
          label="GitHub"
          value={links.github ?? ""}
          onChange={(v) => setLink("github", v)}
          placeholder="github.com/…"
        />
        <LabeledInput
          label="Portfolio"
          value={links.portfolio ?? ""}
          onChange={(v) => setLink("portfolio", v)}
          placeholder="yoursite.com"
        />
      </div>
    </div>
  );
}
