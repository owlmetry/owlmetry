import { createPrivateKey, sign as cryptoSign } from "node:crypto";

/**
 * Sign an ES256 (ECDSA P-256 + SHA-256) JWT with raw r||s signature encoding.
 * Apple's APIs (App Store Connect, Apple Search Ads, APNs) all use this
 * shape and reject DER-encoded signatures — `dsaEncoding: "ieee-p1363"`
 * gives the raw form Apple expects.
 */
export function signEs256Jwt(args: {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  keyPem: string;
}): string {
  const signingInput = `${base64Url(JSON.stringify(args.header))}.${base64Url(JSON.stringify(args.payload))}`;
  const key = createPrivateKey({ key: args.keyPem, format: "pem" });
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
