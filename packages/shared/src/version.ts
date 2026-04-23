// Semver-aware-ish version comparison.
//
// Apps in the wild use a mix of conventions:
//   "1.2.3", "v1.2.3", "1.2.3 (456)" (build), "1.0.0-beta", "2024.10.15".
// This module compares them sensibly without strictly enforcing semver
// (which would reject the long tail of valid app version strings).

interface Normalized {
  segs: string[];
  pre: string | null;
}

function normalize(v: string): Normalized {
  let s = v.trim();
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  // Strip parenthesised build number suffix: "1.2.3 (456)" -> "1.2.3"
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Split off semver pre-release suffix: "1.0.0-beta.2" -> base "1.0.0", pre "beta.2"
  const dashIdx = s.indexOf("-");
  let pre: string | null = null;
  if (dashIdx >= 0) {
    pre = s.slice(dashIdx + 1);
    s = s.slice(0, dashIdx);
  }
  return { segs: s.split("."), pre };
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
  const aN = normalize(a);
  const bN = normalize(b);
  const len = Math.max(aN.segs.length, bN.segs.length);
  for (let i = 0; i < len; i++) {
    const aSeg = aN.segs[i] ?? "0";
    const bSeg = bN.segs[i] ?? "0";
    const result = compareSegment(aSeg, bSeg);
    if (result !== 0) return result;
  }
  // Base versions equal — apply semver pre-release ordering: a release
  // ranks higher than any pre-release of the same base ("1.0.0" > "1.0.0-beta").
  if (aN.pre === null && bN.pre === null) return 0;
  if (aN.pre === null) return 1;
  if (bN.pre === null) return -1;
  if (aN.pre < bN.pre) return -1;
  if (aN.pre > bN.pre) return 1;
  return 0;
}

export function isLatestVersion(
  version: string | null,
  latest: string | null,
): boolean | null {
  if (!version || !latest) return null;
  return compareVersions(version, latest) === 0;
}
