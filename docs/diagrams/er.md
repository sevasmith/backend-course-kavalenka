# ER diagram: first version

The tables known so far: users, the two email-confirmation challenge tables, and the 7 RBAC tables.

Sources: `task.md` (sections 2 and 3), theory `1.0`, `1.2`, `1.4`, `1.5`.

Later stages add more tables; they are not drawn yet:
`email_change_challenges`, `storage_cleanup_jobs` (stage 8), `deletion_challenges`, `deletion_jobs` (stage 9),
and the transformation history (stages 14 and 15).

```mermaid
erDiagram
  users ||--o{ registration_challenges : "confirms registration"
  users ||--o{ login_challenges : "confirms login"
  users ||--o{ user_roles : "has"
  roles ||--o{ user_roles : "assigned to"
  roles ||--o{ grants : "receives"
  permissions ||--o{ grants : "granted by"
  permissions ||--|{ permission_actions : "defines"
  grants ||--o{ grant_actions : "lists"
  permission_actions ||--o{ grant_actions : "used in"

  users {
    uuid id PK
    text email UK "normalized, lowercase"
    text password_hash "Argon2id or bcrypt, salt inside"
    text display_name "nullable, 1-80 code points"
    text photo_key UK "nullable, opaque storage key"
    user_status status "pending | active | blocked | deleting | deleted"
    timestamptz created_at
    timestamptz updated_at
  }

  registration_challenges {
    uuid id PK "attemptId"
    uuid user_id FK "users.id"
    challenge_method method "otp | magic_link"
    text secret_hash "HMAC-SHA256, never the secret"
    timestamptz expires_at "last_sent_at + 10 min"
    int attempts "max 5 wrong OTP entries"
    timestamptz last_sent_at "resend after 60 s"
    timestamptz consumed_at "nullable"
    consumed_reason consumed_reason "nullable until consumed"
  }

  login_challenges {
    uuid id PK "attemptId"
    uuid user_id FK "users.id, one unconsumed per user"
    challenge_method method "otp | magic_link"
    text secret_hash "HMAC-SHA256, separate key"
    timestamptz last_sent_at "TTL and resend pause count from here"
    int attempts "max 5 wrong OTP entries"
    timestamptz consumed_at "nullable"
    consumed_reason consumed_reason "nullable until consumed"
    timestamptz created_at
  }

  roles {
    uuid id PK
    text name UK "normalized"
    text description "nullable, max 500"
    timestamptz created_at
    timestamptz updated_at
  }

  permissions {
    uuid id PK
    text name UK "users | transformations | rbac"
    text description "nullable, max 500"
    timestamptz created_at
    timestamptz updated_at
  }

  permission_actions {
    uuid id PK
    uuid permission_id FK "permissions.id, ON DELETE CASCADE"
    text name "read, update, ...; unique with permission_id"
  }

  grants {
    uuid id PK
    uuid role_id FK "roles.id, ON DELETE CASCADE"
    uuid permission_id FK "permissions.id, ON DELETE CASCADE"
    boolean all_actions "unique pair role_id + permission_id"
    timestamptz created_at
    timestamptz updated_at
  }

  grant_actions {
    uuid grant_id PK, FK "grants.id, ON DELETE CASCADE"
    uuid permission_action_id PK, FK "permission_actions.id, ON DELETE RESTRICT"
  }

  user_roles {
    uuid user_id PK, FK "users.id, ON DELETE CASCADE"
    uuid role_id PK, FK "roles.id, ON DELETE RESTRICT"
  }

  rbac_policy_state {
    int id PK "always 1, single row"
    bigint version "monotonically increasing"
    timestamptz updated_at
  }
```

## Reading the diagram

- `||--o{` means "one to zero or more": a user can have no challenges or many (old ones stay as consumed history).
- `||--|{` means "one to one or more": every permission has at least one action (`POST /admin/rbac/permissions` requires 1 to 64 actions).
- `grant_actions` and `user_roles` are **junction tables** for many-to-many links. Their primary key is the pair of foreign keys.
- `rbac_policy_state` has no relationships. It is a single-row version counter: any RBAC change increments `version`, and every app instance reloads its policy snapshot when it sees a newer one.
- `consumed_reason` values: `confirmed`, `replaced`, `attempts_exhausted`, `user_inactive`.

## Open points

- **`registration_challenges.expires_at`.** Theory `1.0` allows either storing it or computing it as `last_sent_at + 10 minutes`. Storing it is a deliberate denormalization (the table drops from BCNF to 2NF). Pick one and be ready to justify it.
- **`users.id` type.** `task.md` uses UUIDs for the RBAC tables, and `user_roles.user_id` is a UUID, so `users.id` is drawn as a UUID too.
