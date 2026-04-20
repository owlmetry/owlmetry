import { DiskFileStorage } from "./file-storage.js";
import { config } from "../config.js";

export { DiskFileStorage } from "./file-storage.js";
export type { FileStorage } from "./file-storage.js";

export const attachmentStorage = new DiskFileStorage(
  config.attachmentsPath,
  config.attachmentsInternalUri
);
