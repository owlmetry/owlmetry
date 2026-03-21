import { vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig, saveConfig, resolveConfig } from "../config.js";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OWLMETRY_ENDPOINT;
  delete process.env.OWLMETRY_API_KEY;
});

describe("loadConfig", () => {
  it("returns parsed config on valid file", () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ endpoint: "http://localhost:4000", api_key: "key" }));
    const config = loadConfig();
    expect(config).toEqual({ endpoint: "http://localhost:4000", api_key: "key" });
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
    saveConfig({ endpoint: "http://localhost:4000", api_key: "key" });
    expect(mockedMkdirSync).toHaveBeenCalledWith(expect.stringContaining(".owlmetry"), { recursive: true });
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain('"endpoint"');
    expect(written).toContain('"api_key"');
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written)).toEqual({ endpoint: "http://localhost:4000", api_key: "key" });
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

  it("falls back to config file", () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ endpoint: "http://file", api_key: "file-key" }));
    const config = resolveConfig({});
    expect(config.endpoint).toBe("http://file");
    expect(config.api_key).toBe("file-key");
  });

  it("skips file read when both resolved from flags/env", () => {
    const config = resolveConfig({ endpoint: "http://flag", apiKey: "flag-key" });
    expect(config).toEqual({ endpoint: "http://flag", api_key: "flag-key" });
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
