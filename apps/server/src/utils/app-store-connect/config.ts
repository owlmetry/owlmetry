/**
 * App Store Connect API integration config — the per-project credentials
 * we ask the user to paste once into Owlmetry's integrations dashboard.
 * Mirrored field-for-field by the `app-store-connect` provider definition
 * in `packages/shared/src/integrations.ts`.
 */
export interface AppStoreConnectConfig {
  /** UUID — your team's ASC API issuer ID. */
  issuer_id: string;
  /** 10-character key ID assigned to the .p8 (also embedded in its filename). */
  key_id: string;
  /** Full PEM contents of the .p8 (PKCS#8 or SEC1 — both accepted by Node's createPrivateKey). */
  private_key_p8: string;
}
