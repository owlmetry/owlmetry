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
