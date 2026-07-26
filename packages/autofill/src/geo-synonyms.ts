// Country/state synonym expansion for dropdown filling. A profile value of "US"
// or "Oregon" must be tried against ATS option labels like "United States of
// America" or the abbreviation "OR". geoCandidates(value) returns every known
// alias for a country/US-state term (or just [value] when it isn't one).

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Each group is a set of interchangeable labels; every member maps to the group.
const COUNTRY_GROUPS: string[][] = [
  ["United States of America", "United States", "USA", "US", "U.S.", "U.S.A.", "America"],
  ["United Kingdom", "UK", "Great Britain", "GB", "Britain", "England"],
  ["Canada", "CA", "CAN"],
  ["Australia", "AU", "AUS"],
  ["India", "IN", "IND"],
  ["China", "CN", "PRC", "People's Republic of China"],
  ["Germany", "DE", "Deutschland"],
  ["France", "FR"],
  ["Netherlands", "NL", "Holland", "The Netherlands"],
  ["Ireland", "IE"],
  ["New Zealand", "NZ"],
  ["Singapore", "SG"],
  ["Mexico", "MX"],
  ["Brazil", "BR", "Brasil"],
  ["Japan", "JP"],
  ["South Korea", "KR", "Korea, Republic of", "Republic of Korea"],
];

// US states + DC: [full name, abbreviation].
const STATE_PAIRS: [string, string][] = [
  ["Alabama", "AL"],
  ["Alaska", "AK"],
  ["Arizona", "AZ"],
  ["Arkansas", "AR"],
  ["California", "CA"],
  ["Colorado", "CO"],
  ["Connecticut", "CT"],
  ["Delaware", "DE"],
  ["District of Columbia", "DC"],
  ["Florida", "FL"],
  ["Georgia", "GA"],
  ["Hawaii", "HI"],
  ["Idaho", "ID"],
  ["Illinois", "IL"],
  ["Indiana", "IN"],
  ["Iowa", "IA"],
  ["Kansas", "KS"],
  ["Kentucky", "KY"],
  ["Louisiana", "LA"],
  ["Maine", "ME"],
  ["Maryland", "MD"],
  ["Massachusetts", "MA"],
  ["Michigan", "MI"],
  ["Minnesota", "MN"],
  ["Mississippi", "MS"],
  ["Missouri", "MO"],
  ["Montana", "MT"],
  ["Nebraska", "NE"],
  ["Nevada", "NV"],
  ["New Hampshire", "NH"],
  ["New Jersey", "NJ"],
  ["New Mexico", "NM"],
  ["New York", "NY"],
  ["North Carolina", "NC"],
  ["North Dakota", "ND"],
  ["Ohio", "OH"],
  ["Oklahoma", "OK"],
  ["Oregon", "OR"],
  ["Pennsylvania", "PA"],
  ["Rhode Island", "RI"],
  ["South Carolina", "SC"],
  ["South Dakota", "SD"],
  ["Tennessee", "TN"],
  ["Texas", "TX"],
  ["Utah", "UT"],
  ["Vermont", "VT"],
  ["Virginia", "VA"],
  ["Washington", "WA"],
  ["West Virginia", "WV"],
  ["Wisconsin", "WI"],
  ["Wyoming", "WY"],
];

const LOOKUP = new Map<string, string[]>();
for (const group of COUNTRY_GROUPS) {
  for (const alias of group) LOOKUP.set(norm(alias), group);
}
for (const [full, abbr] of STATE_PAIRS) {
  const group = [full, abbr];
  LOOKUP.set(norm(full), group);
  LOOKUP.set(norm(abbr), group);
}

export function geoCandidates(value: string): string[] {
  const group = LOOKUP.get(norm(value));
  if (!group) return [value];
  // Put the original value first, then the rest of the group (deduped).
  return [value, ...group.filter((g) => norm(g) !== norm(value))];
}
