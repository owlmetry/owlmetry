import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfiguration } from "../../src/configuration.js";

describe("validateConfiguration", () => {
  const validConfig = {
    endpoint: "http://localhost:4000",
    apiKey: "owl_client_test_key_1234567890123456",
  };

  it("accepts valid configuration", () => {
    const result = validateConfiguration(validConfig);
    assert.equal(result.endpoint, "http://localhost:4000");
    assert.equal(result.apiKey, validConfig.apiKey);
    assert.equal(result.debug, false);
    assert.equal(result.flushIntervalMs, 5000);
    assert.equal(result.flushThreshold, 20);
    assert.equal(result.maxBufferSize, 10000);
  });

  it("strips trailing slash from endpoint", () => {
    const result = validateConfiguration({ ...validConfig, endpoint: "http://localhost:4000/" });
    assert.equal(result.endpoint, "http://localhost:4000");
  });

  it("rejects empty endpoint", () => {
    assert.throws(
      () => validateConfiguration({ ...validConfig, endpoint: "" }),
      /endpoint is required/,
    );
  });

  it("rejects invalid endpoint URL", () => {
    assert.throws(
      () => validateConfiguration({ ...validConfig, endpoint: "not-a-url" }),
      /invalid endpoint URL/,
    );
  });

  it("rejects empty apiKey", () => {
    assert.throws(
      () => validateConfiguration({ ...validConfig, apiKey: "" }),
      /apiKey is required/,
    );
  });

  it("rejects agent key prefix", () => {
    assert.throws(
      () => validateConfiguration({ ...validConfig, apiKey: "owl_agent_abc123" }),
      /must start with "owl_client_"/,
    );
  });

  it("rejects arbitrary key prefix", () => {
    assert.throws(
      () => validateConfiguration({ ...validConfig, apiKey: "some_random_key" }),
      /must start with "owl_client_"/,
    );
  });

  it("applies custom options", () => {
    const result = validateConfiguration({
      ...validConfig,
      serviceName: "api-server",
      appVersion: "2.0.0",
      debug: true,
      flushIntervalMs: 1000,
      flushThreshold: 50,
      maxBufferSize: 5000,
    });

    assert.equal(result.serviceName, "api-server");
    assert.equal(result.appVersion, "2.0.0");
    assert.equal(result.debug, true);
    assert.equal(result.flushIntervalMs, 1000);
    assert.equal(result.flushThreshold, 50);
    assert.equal(result.maxBufferSize, 5000);
  });

  it("defaults serviceName to 'unknown'", () => {
    const result = validateConfiguration(validConfig);
    assert.equal(result.serviceName, "unknown");
  });
});
