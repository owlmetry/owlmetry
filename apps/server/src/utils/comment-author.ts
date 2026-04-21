import { eq } from "drizzle-orm";
import { users, apiKeys } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import type { AuthContext } from "../types.js";

export interface CommentAuthor {
  authorType: "user" | "agent";
  authorId: string;
  authorName: string;
}

/**
 * Resolve the author fields for a comment insert from the authenticated caller.
 * User JWT → user's display name (falls back to their email).
 * Agent key → the key's label (falls back to "Agent").
 */
export async function resolveCommentAuthor(
  db: Db,
  auth: AuthContext,
): Promise<CommentAuthor> {
  if (auth.type === "user") {
    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, auth.user_id))
      .limit(1);
    return {
      authorType: "user",
      authorId: auth.user_id,
      authorName: user?.name ?? auth.email,
    };
  }
  const [key] = await db
    .select({ name: apiKeys.name })
    .from(apiKeys)
    .where(eq(apiKeys.id, auth.key_id))
    .limit(1);
  return {
    authorType: "agent",
    authorId: auth.key_id,
    authorName: key?.name ?? "Agent",
  };
}
