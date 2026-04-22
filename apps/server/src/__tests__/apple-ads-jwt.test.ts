import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { signAppleAdsClientAssertion } from "../utils/apple-ads/jwt.js";

function decodeBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function generateEcKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey,
  };
}

describe("signAppleAdsClientAssertion", () => {
  it("produces a three-segment JWT with correct header and payload", () => {
    const { privateKeyPem } = generateEcKeypair();
    const iat = 1700000000;
    const exp = iat + 300;
    const jwt = signAppleAdsClientAssertion(
      {
        client_id: "SEARCHADS.my-client-id",
        team_id: "SEARCHADS.my-team-id",
        key_id: "my-key-id",
        private_key_pem: privateKeyPem,
      },
      { iat, exp },
    );

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(decodeBase64Url(parts[0]).toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: "my-key-id", typ: "JWT" });

    const payload = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
    expect(payload).toEqual({
      iss: "SEARCHADS.my-team-id",
      sub: "SEARCHADS.my-client-id",
      aud: "https://appleid.apple.com",
      iat,
      exp,
    });
  });

  it("signs the JWT so the matching public key verifies it (ES256, raw r||s encoding)", () => {
    const { privateKeyPem, publicKey } = generateEcKeypair();
    const iat = 1700000000;
    const jwt = signAppleAdsClientAssertion(
      {
        client_id: "SEARCHADS.my-client-id",
        team_id: "SEARCHADS.my-team-id",
        key_id: "my-key-id",
        private_key_pem: privateKeyPem,
      },
      { iat, exp: iat + 300 },
    );

    const [h, p, s] = jwt.split(".");
    const signingInput = Buffer.from(`${h}.${p}`);
    const signature = decodeBase64Url(s);
    // Apple wants raw (r||s) = 64 bytes for ES256/P-256.
    expect(signature.length).toBe(64);

    const verified = cryptoVerify("sha256", signingInput, {
      key: publicKey,
      dsaEncoding: "ieee-p1363",
    }, signature);
    expect(verified).toBe(true);
  });

  it("defaults exp to iat + 300 seconds when not provided", () => {
    const { privateKeyPem } = generateEcKeypair();
    const iat = 1700000000;
    const jwt = signAppleAdsClientAssertion(
      {
        client_id: "c",
        team_id: "t",
        key_id: "k",
        private_key_pem: privateKeyPem,
      },
      { iat },
    );
    const payload = JSON.parse(decodeBase64Url(jwt.split(".")[1]).toString("utf8"));
    expect(payload.exp).toBe(iat + 300);
  });

  it("throws when the private key PEM is malformed", () => {
    expect(() =>
      signAppleAdsClientAssertion({
        client_id: "c",
        team_id: "t",
        key_id: "k",
        private_key_pem: "not a real pem",
      }),
    ).toThrow();
  });
});
