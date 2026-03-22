import { vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig, saveConfig, resolveConfig, getActiveProfile, listProfiles } from "../config.js";
import type { CliConfig } from "../config.js";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

function makeConfig(overrides?: Partial<CliConfig>): CliConfig {
  return {
    endpoint: "http://localhost:4000",
    active_team: "team-1",
    teams: {
      "team-1": { api_key: "key-1", team_name: "Acme Corp", team_slug: "acme" },
    },
    ...overrides,
  };
}

function makeTwoTeamConfig(): CliConfig {
  return makeConfig({
    teams: {
      "team-1": { api_key: "key-1", team_name: "Acme Corp", team_slug: "acme" },
      "team-2": { api_key: "key-2", team_name: "Beta Inc", team_slug: "beta" },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OWLMETRY_ENDPOINT;
  delete process.env.OWLMETRY_API_KEY;
});

describe("loadConfig", () => {
  it("returns parsed config on valid file", () => {
    const config = makeConfig();
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));
    const result = loadConfig();
    expect(result).toEqual(config);
  });

  it("returns null when file is missing", () => {
    mockedReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(loadConfig()).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    mockedReadFileSync.mockReturnValue("not json");
    expect(loadConfig()).toBeNull();
  });
});

describe("saveConfig", () => {
  it("creates dir recursively and writes formatted JSON", () => {
    const config = makeConfig();
    saveConfig(config);
    expect(mockedMkdirSync).toHaveBeenCalledWith(expect.stringContaining(".owlmetry"), { recursive: true });
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain('"active_team"');
    expect(written).toContain('"teams"');
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written)).toEqual(config);
  });
});

describe("getActiveProfile", () => {
  it("returns active team profile when no hint provided", () => {
    const config = makeTwoTeamConfig();
    const result = getActiveProfile(config);
    expect(result.teamId).toBe("team-1");
    expect(result.profile.team_name).toBe("Acme Corp");
  });

  it("matches by exact team ID", () => {
    const config = makeTwoTeamConfig();
    const result = getActiveProfile(config, "team-2");
    expect(result.teamId).toBe("team-2");
    expect(result.profile.team_name).toBe("Beta Inc");
  });

  it("matches by exact slug", () => {
    const config = makeTwoTeamConfig();
    const result = getActiveProfile(config, "beta");
    expect(result.teamId).toBe("team-2");
  });

  it("matches by name case-insensitively", () => {
    const config = makeTwoTeamConfig();
    const result = getActiveProfile(config, "acme corp");
    expect(result.teamId).toBe("team-1");
  });

  it("throws with available teams when no match", () => {
    const config = makeTwoTeamConfig();
    expect(() => getActiveProfile(config, "nonexistent")).toThrow(/No team matching/);
    expect(() => getActiveProfile(config, "nonexistent")).toThrow(/Acme Corp/);
  });

  it("throws when no profiles configured", () => {
    const config = makeConfig({ teams: {} });
    expect(() => getActiveProfile(config)).toThrow(/No team profiles configured/);
  });

  it("throws when active_team points to missing profile", () => {
    const config = makeConfig({ active_team: "deleted-team" });
    expect(() => getActiveProfile(config)).toThrow(/Active team.*not found/);
  });
});

describe("listProfiles", () => {
  it("marks the active profile", () => {
    const config = makeTwoTeamConfig();
    const profiles = listProfiles(config);
    expect(profiles).toHaveLength(2);
    const active = profiles.find(p => p.active);
    expect(active?.teamId).toBe("team-1");
    const inactive = profiles.find(p => !p.active);
    expect(inactive?.teamId).toBe("team-2");
  });
});

describe("resolveConfig", () => {
  it("CLI flags take highest priority", () => {
    process.env.OWLMETRY_ENDPOINT = "http://env";
    process.env.OWLMETRY_API_KEY = "env-key";
    const config = resolveConfig({ endpoint: "http://flag", apiKey: "flag-key" });
    expect(config.endpoint).toBe("http://flag");
    expect(config.api_key).toBe("flag-key");
  });

  it("falls back to env vars", () => {
    process.env.OWLMETRY_ENDPOINT = "http://env";
    process.env.OWLMETRY_API_KEY = "env-key";
    const config = resolveConfig({});
    expect(config.endpoint).toBe("http://env");
    expect(config.api_key).toBe("env-key");
  });

  it("falls back to active profile from config file", () => {
    const fileConfig = makeConfig();
    mockedReadFileSync.mockReturnValue(JSON.stringify(fileConfig));
    const config = resolveConfig({});
    expect(config.endpoint).toBe("http://localhost:4000");
    expect(config.api_key).toBe("key-1");
  });

  it("--team flag selects profile by slug", () => {
    const fileConfig = makeTwoTeamConfig();
    mockedReadFileSync.mockReturnValue(JSON.stringify(fileConfig));
    const config = resolveConfig({ team: "beta" });
    expect(config.api_key).toBe("key-2");
  });

  it("--team flag selects profile by name", () => {
    const fileConfig = makeTwoTeamConfig();
    mockedReadFileSync.mockReturnValue(JSON.stringify(fileConfig));
    const config = resolveConfig({ team: "Beta Inc" });
    expect(config.api_key).toBe("key-2");
  });

  it("--team flag selects profile by ID", () => {
    const fileConfig = makeTwoTeamConfig();
    mockedReadFileSync.mockReturnValue(JSON.stringify(fileConfig));
    const config = resolveConfig({ team: "team-2" });
    expect(config.api_key).toBe("key-2");
  });

  it("--team flag throws on no match", () => {
    const fileConfig = makeTwoTeamConfig();
    mockedReadFileSync.mockReturnValue(JSON.stringify(fileConfig));
    expect(() => resolveConfig({ team: "nonexistent" })).toThrow(/No team matching/);
  });

  it("skips file read when both resolved from flags/env", () => {
    const config = resolveConfig({ endpoint: "http://flag", apiKey: "flag-key" });
    expect(config).toEqual({ endpoint: "http://flag", api_key: "flag-key", ingest_endpoint: undefined });
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  it("throws with helpful message when endpoint missing", () => {
    process.env.OWLMETRY_API_KEY = "key";
    mockedReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(() => resolveConfig({})).toThrow(/Missing endpoint/);
    expect(() => resolveConfig({})).toThrow(/--endpoint/);
  });

  it("throws with helpful message when api_key missing", () => {
    process.env.OWLMETRY_ENDPOINT = "http://host";
    mockedReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(() => resolveConfig({})).toThrow(/Missing API key/);
    expect(() => resolveConfig({})).toThrow(/--api-key/);
  });
});
