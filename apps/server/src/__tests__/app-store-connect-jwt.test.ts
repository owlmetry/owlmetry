import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { signAppStoreConnectJwt, validateAppStoreConnectPem } from "../utils/app-store-connect/jwt.js";

function decodeBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function generateEcKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    sec1Pem: privateKey.export({ format: "pem", type: "sec1" }).toString(),
    publicKey,
  };
}

describe("signAppStoreConnectJwt", () => {
  it("produces a three-segment JWT with the ASC header + payload shape", () => {
    const { privateKeyPem } = generateEcKeypair();
    const iat = 1700000000;
    const exp = iat + 1140;
    const jwt = signAppStoreConnectJwt(
      {
        issuer_id: "ba9b5d8b-7fe8-46f8-9960-9a3720f88015",
        key_id: "ABC1234567",
        private_key_p8: privateKeyPem,
      },
      { iat, exp },
    );

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(decodeBase64Url(parts[0]).toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: "ABC1234567", typ: "JWT" });

    const payload = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
    expect(payload).toEqual({
      iss: "ba9b5d8b-7fe8-46f8-9960-9a3720f88015",
      iat,
      exp,
      aud: "appstoreconnect-v1",
    });
  });

  it("signs with ES256 raw r||s encoding (Apple-required)", () => {
    const { privateKeyPem, publicKey } = generateEcKeypair();
    const iat = 1700000000;
    const jwt = signAppStoreConnectJwt(
      { issuer_id: "i", key_id: "k", private_key_p8: privateKeyPem },
      { iat, exp: iat + 1140 },
    );
    const [h, p, s] = jwt.split(".");
    const signature = decodeBase64Url(s);
    expect(signature.length).toBe(64);

    const verified = cryptoVerify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
    expect(verified).toBe(true);
  });

  it("defaults exp to iat + 1140s (19 minutes — under Apple's 20-min cap)", () => {
    const { privateKeyPem } = generateEcKeypair();
    const iat = 1700000000;
    const jwt = signAppStoreConnectJwt(
      { issuer_id: "i", key_id: "k", private_key_p8: privateKeyPem },
      { iat },
    );
    const payload = JSON.parse(decodeBase64Url(jwt.split(".")[1]).toString("utf8"));
    expect(payload.exp).toBe(iat + 1140);
    expect(payload.exp - payload.iat).toBeLessThan(1200);
  });

  it("accepts SEC1 PEM (BEGIN EC PRIVATE KEY) as well as PKCS#8", () => {
    const { sec1Pem } = generateEcKeypair();
    expect(() =>
      signAppStoreConnectJwt({ issuer_id: "i", key_id: "k", private_key_p8: sec1Pem }),
    ).not.toThrow();
  });

  it("throws when the .p8 contents are malformed", () => {
    expect(() =>
      signAppStoreConnectJwt({ issuer_id: "i", key_id: "k", private_key_p8: "not a real pem" }),
    ).toThrow();
  });
});

describe("validateAppStoreConnectPem", () => {
  it("returns null for a valid PKCS#8 PEM", () => {
    const { privateKeyPem } = generateEcKeypair();
    expect(validateAppStoreConnectPem(privateKeyPem)).toBeNull();
  });

  it("returns null for a valid SEC1 PEM", () => {
    const { sec1Pem } = generateEcKeypair();
    expect(validateAppStoreConnectPem(sec1Pem)).toBeNull();
  });

  it("returns an error string for a non-PEM input", () => {
    const result = validateAppStoreConnectPem("not a pem");
    expect(result).not.toBeNull();
    expect(result).toContain("private_key_p8");
  });

  it("returns an error string when only the BEGIN/END markers are present", () => {
    const result = validateAppStoreConnectPem("-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----");
    expect(result).not.toBeNull();
  });
});
