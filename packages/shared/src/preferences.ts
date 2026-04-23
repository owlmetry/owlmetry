/**
 * Per-user UI preferences, persisted as JSONB on the `users` row.
 *
 * Kept intentionally open-ended — anything under `ui` is owned by the dashboard
 * and the server merges shallowly at the top level (see PATCH /v1/auth/me) so
 * two tabs editing different sub-objects don't clobber each other.
 *
 * Column model: a single ordered list of visible column ids. A registry id
 * that isn't in `order` is hidden. Adding a new column to the registry later
 * surfaces it in the picker's "Available" bucket for users who have customized
 * (their `order` is defined); users who have never customized keep seeing
 * defaults from code, so new built-in columns show up automatically.
 */

export interface ColumnConfig {
  /** Ordered list of visible column ids; anything not listed is hidden. */
  order: string[];
}

export interface UserPreferences {
  version?: 1;
  ui?: {
    columns?: {
      events?: ColumnConfig;
      users?: ColumnConfig;
    };
  };
}

/**
 * Top-level shallow merge; deep-replace any nested object the patch provides.
 * Two tabs editing different sub-objects (e.g. events vs users column layout)
 * don't clobber each other; same-page last-write-wins. Used by both the
 * server PATCH handler and the client's optimistic cache update.
 */
export function mergeUserPreferences(
  existing: UserPreferences | null | undefined,
  patch: Partial<UserPreferences>,
): UserPreferences {
  const base = existing ?? {};
  const merged: UserPreferences = { ...base };
  if (patch.version !== undefined) merged.version = patch.version;
  if (patch.ui !== undefined) {
    merged.ui = { ...base.ui };
    if (patch.ui.columns !== undefined) {
      merged.ui.columns = { ...base.ui?.columns, ...patch.ui.columns };
    }
  }
  return merged;
}

/** True iff `order` is element-by-element identical to `defaultOrder`. */
export function isDefaultColumnOrder(order: string[], defaultOrder: string[]): boolean {
  if (order.length !== defaultOrder.length) return false;
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== defaultOrder[i]) return false;
  }
  return true;
}
