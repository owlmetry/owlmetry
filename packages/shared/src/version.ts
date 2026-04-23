// Semver-aware-ish version comparison.
//
// Apps in the wild use a mix of conventions:
//   "1.2.3", "v1.2.3", "1.2.3 (456)" (build), "1.0.0-beta", "2024.10.15".
// This module compares them sensibly without strictly enforcing semver
// (which would reject the long tail of valid app version strings).

function normalize(v: string): string[] {
  let s = v.trim();
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  // Strip parenthesised build number suffix: "1.2.3 (456)" -> "1.2.3"
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return s.split(".");
}

function compareSegment(a: string, b: string): -1 | 0 | 1 {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const ai = parseInt(a, 10);
    const bi = parseInt(b, 10);
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const aSegs = normalize(a);
  const bSegs = normalize(b);
  const len = Math.max(aSegs.length, bSegs.length);
  for (let i = 0; i < len; i++) {
    const aSeg = aSegs[i] ?? "0";
    const bSeg = bSegs[i] ?? "0";
    const result = compareSegment(aSeg, bSeg);
    if (result !== 0) return result;
  }
  return 0;
}

export function isLatestVersion(
  version: string | null,
  latest: string | null,
): boolean | null {
  if (!version || !latest) return null;
  return compareVersions(version, latest) === 0;
}
