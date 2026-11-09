# RBAC data model

Design of the 7 RBAC tables: keys, delete rules, constraints and indexes.
The tables and their relationships are drawn in [er.md](er.md); this file adds what the diagram can't show.

Sources: `task.md` (section "Relational Data Model Schema"), theory `1.1` (Practical Assignment).

## Tables

| Table | Primary key | Foreign keys | Unique | Checks and defaults |
| --- | --- | --- | --- | --- |
| `roles` | `id` uuid | — | `name` | `description` null or ≤ 500 chars |
| `permissions` | `id` uuid | — | `name` | `description` null or ≤ 500 chars |
| `permission_actions` | `id` uuid | `permission_id → permissions` **CASCADE** | `(permission_id, name)` | — |
| `grants` | `id` uuid | `role_id → roles` **CASCADE**, `permission_id → permissions` **CASCADE** | `(role_id, permission_id)` | `all_actions` not null, default `false` |
| `grant_actions` | `(grant_id, permission_action_id)` | `grant_id → grants` **CASCADE**, `permission_action_id → permission_actions` **RESTRICT** | (the PK) | — |
| `user_roles` | `(user_id, role_id)` | `user_id → users` **CASCADE**, `role_id → roles` **RESTRICT** | (the PK) | — |
| `rbac_policy_state` | `id` int | — | — | `id = 1`, `version ≥ 0`, `version` default `0`, `updated_at` default `now()` |

- Every `created_at` / `updated_at` is `timestamptz not null default now()`.
- Names (`roles.name`, `permissions.name`, `permission_actions.name`) are stored **already normalized** (trimmed, lowercase, `^[a-z][a-z0-9._-]{0,63}$`). The API normalizes them, so the unique constraints compare normalized values.
- `rbac_policy_state` holds exactly one row (`id = 1`), inserted by the migration. `CHECK (id = 1)` makes a second row impossible.

## Delete rules

The rule is: **CASCADE** when the child is just a detail of its parent, **RESTRICT** when deleting would silently take access away from someone.

| Delete… | What happens in the DB | What the API does |
| --- | --- | --- |
| a permission | its actions and grants are deleted (CASCADE); the grants' `grant_actions` go too | returns **409** if any grant uses it, so the cascade never fires through the API |
| a permission action (removed in `PUT /permissions/{id}`) | **blocked** if any `grant_actions` row uses it (RESTRICT) | returns **409**; if only `all_actions = true` grants use it, it is removed without a conflict |
| a role | its grants are deleted (CASCADE); **blocked** if any user has it (RESTRICT) | returns **409** if any user or grant uses it |
| a grant | its `grant_actions` are deleted (CASCADE) | allowed, but rejected with **409** if it would leave 0 users with `rbac@manage` |
| a user (hard delete) | its `user_roles` are deleted (CASCADE) | the user is never hard-deleted through the API; deletion (1.6) removes `user_roles` itself and bumps the version |

RESTRICT is a safety net: even with a bug in a service, the DB never leaves a user pointing at a missing role or a grant pointing at a missing action.

## Indexes

PostgreSQL indexes primary keys and unique constraints automatically, but **not foreign keys**.
A composite index only helps lookups on its **leading** column, so only FK columns that don't come first in an existing index need one.

| Index | Covers |
| --- | --- |
| `roles(name)` unique | lookup by name, uniqueness |
| `permissions(name)` unique | lookup by name, uniqueness |
| `permission_actions(permission_id, name)` unique | actions of a permission (leading column) |
| `grants(role_id, permission_id)` unique | grants of a role (leading column) |
| **`grants(permission_id)`** | "is this permission used by a grant" (409), the CASCADE from `permissions` |
| `grant_actions(grant_id, permission_action_id)` PK | actions of a grant |
| **`grant_actions(permission_action_id)`** | "is this action used by a grant" (409), the RESTRICT check |
| `user_roles(user_id, role_id)` PK | roles of a user (the hot path for `authorize`) |
| **`user_roles(role_id)`** | "is this role assigned" (409), the RESTRICT check, the `rbac@manage` invariant query |

The three bold indexes are the ones to add by hand.

## Rules the DB doesn't enforce

These are checked in the service, inside the same transaction as the change:

1. **A grant's actions belong to the grant's permission.** `grant_actions` references the action by id only, so the DB would accept an action of a different permission.
2. **`all_actions = true` means no `grant_actions` rows**, and `all_actions = false` means at least one.
3. **At least one active user keeps `rbac@manage`** (the super-administrator invariant, plan task 9).
4. **Every change bumps `rbac_policy_state.version`** in the same transaction (plan task 9).

Rule 1 could be enforced in the DB with a composite FK: add `UNIQUE (id, permission_id)` on `permission_actions`, store `permission_id` in `grant_actions`, and reference the pair. That duplicates a column against the schema in `task.md`, so we keep the check in the service.

## Normal form

All tables are in BCNF (theory `1.1`): every non-key column depends on the whole key and nothing else. The only derived data is the in-memory policy snapshot, which is rebuilt from these tables and guarded by `version`.
