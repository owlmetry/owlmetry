import { generateKeyPairSync } from "node:crypto";

/**
 * Generate an EC P-256 keypair for Apple Ads Campaign Management API auth.
 *
 * Apple's client-assertion flow (see jwt.ts) is ES256 / prime256v1. We keep
 * the private half server-side on the integration config and surface the
 * public half to the user once so they can paste it into
 * ads.apple.com → Account Settings → API. Apple issues the
 * client/team/key IDs back after ingesting the public key; those become the
 * other half of the saved config.
 *
 * PEM shapes:
 * - Private key: PKCS#8 (`-----BEGIN PRIVATE KEY-----`). Node's
 *   `createPrivateKey({ format: "pem" })` auto-detects both PKCS#1 and
 *   PKCS#8, but PKCS#8 is the modern default and matches what Apple's own
 *   docs recommend for new integrations.
 * - Public key: SubjectPublicKeyInfo (`-----BEGIN PUBLIC KEY-----`). Apple's
 *   "Upload Public Key" form accepts exactly this format.
 */
export function generateAppleAdsKeypair(): { private_key_pem: string; public_key_pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    private_key_pem: privateKey as string,
    public_key_pem: publicKey as string,
  };
}
