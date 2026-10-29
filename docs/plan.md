# Course Plan

A step-by-step plan for finishing the assignment in [`task.md`](./task.md). Each stage is split into small steps, and each step pairs **theory to read first** with **practice to build**.

> This plan says *what* to build and *how to check it*, not *how to write the code*. Writing the code is your job. Ask me for hints, explanations and reviews at any point.
>
> If you want me to write a specific file or part of the code, ask me for it explicitly and I'll write it, along with an explanation of how it works. Make sure you understand that code well enough to defend it in your review.

---

## How to use this plan

Every step has the same four parts:

| Part | What it means |
| --- | --- |
| 📖 **Read first** | Theory to study before writing any code. Section names refer to files in [`docs/theory/`](./theory/). |
| 🛠 **Build** | The outcome to achieve, described as behaviour, not code. |
| ✅ **Done when** | How to check the step works: an HTTP request and its expected response, a test, or a database check. |
| ❓ **Check yourself** | Questions to answer in your own words before moving on. Your course mentor will ask similar ones. |

**Working rhythm for every step**

1. Read the theory. Write down anything unclear and ask me about it.
2. Read the matching **Practical Assignment** section at the end of that theory file. It has the exact contract, errors and edge cases, and is more detailed than `task.md`.
3. Build the step in small commits.
4. Check it with an HTTP client (Postman, Insomnia, `curl`) and with tests.
5. Answer the "Check yourself" questions.
6. Ask me for a review, then tick the box and move on.

> 💡 If `task.md` and a theory file disagree on a detail (for example, the exact fields of a response), write it down and agree it with your course mentor before building.

**Progress overview**

- [x] Stage 0. Foundations and project setup
- [ ] Stage 1. Users table and registration
- [ ] Stage 2. RBAC: data model and bootstrap
- [ ] Stage 3. Authentication: login, tokens, cookies
- [ ] Stage 4. Authorization: the security chain
- [ ] Stage 5. RBAC administrative API and live policy reload
- [ ] Stage 6. Email confirmation (registration and login)
- [ ] Stage 7. Viewing user data
- [ ] Stage 8. Storage adapter and changing user data
- [ ] Stage 9. Deleting a user (background job)
- [ ] Stage 10. Administrative user list
- [ ] Stage 11. File transformation: common foundation
- [ ] Stage 12. Text format transformation
- [ ] Stage 13. Image transformation
- [ ] Stage 14. Transformation history
- [ ] Stage 15. Saving results to storage and retention
- [ ] Stage 16. Final hardening and review

> Why this order? Each stage only uses things that already exist. You need users before you can log in, a login before you can check permissions, and permissions before you can protect the user and file endpoints. Email confirmation comes after the core login flow so that you get a working end-to-end system early, then add the extra branch.

---

## Stage 0. Foundations and project setup

**Goal:** understand the big picture and get the boilerplate running before writing any feature.

### 0.1 Read the course overview and the spec

- 📖 **Read first:** `0.0 Introduction.md`; [`task.md`](./task.md), the whole file once, without trying to understand every detail.
- 🛠 **Build:** nothing yet. Make a short list (for yourself) of every endpoint in `task.md` and every table it mentions.
- ✅ **Done when:** you have the list and can say in two sentences what the final service does.
- ❓ **Check yourself:**
  - What are the five main modules of the service?
  - Which parts of the system run in the background, outside an HTTP request?

### 0.2 Backend architecture

- 📖 **Read first:** `0.3 Back End Architectures.md` (Monolith, Modular Monolith, Layers, Ports and Adapters).
- 🛠 **Build:** nothing yet. Look at `src/` and `README.md` and map each folder to an idea from the theory (module, layer, adapter).
- ✅ **Done when:** you can explain how a request travels through a NestJS app: controller → service → repository → database.
- ❓ **Check yourself:**
  - Why is this service a *monolith*, and what does *stateless* mean for it?
  - What is the job of a controller, and what should never be inside it?
  - The file storage has two adapters (local and S3). Which architecture pattern is that?

### 0.3 Run the boilerplate locally

- 📖 **Read first:** project `README.md`; the NestJS docs pages "First steps", "Modules", "Controllers", "Providers".
- 🛠 **Build:** create `.env` from `.env.example`, start PostgreSQL with Docker Compose, run the app in dev mode.
- ✅ **Done when:** the app starts without errors and the health endpoint answers (see `src/core/health/README.MD`). `npm run lint`, `npm run test` and `npm run build` pass.
- ❓ **Check yourself:**
  - What does `ConfigModule` do with the Joi schema, and what happens if a required variable is missing?
  - What is the difference between Fastify and Express, and why does it matter when you read examples online?

### 0.4 Databases refresher

- 📖 **Read first:** `0.1 Databases.md` (Relational Model; Keys, Constraints, Relationships; Transactions and ACID; Indexes; Working with the Database from an Application).
- 🛠 **Build:** connect to the local database with a client (DBeaver, TablePlus, `psql`) and look around. Read the TypeORM docs on entities and migrations.
- ✅ **Done when:** you can create and revert an empty migration with the npm scripts from `README.md`.
- ❓ **Check yourself:**
  - Why does this project use migrations instead of `synchronize: true`?
  - What does a unique constraint give you that a "check first, then insert" in code does not?
  - What does ACID mean, and which letter protects you when two inserts must succeed or fail together?

### 0.5 UML for planning

- 📖 **Read first:** `0.2 UML Diagrams.md` (Class Diagram, Sequence Diagram, State Diagram, Diagrams as Code).
- 🛠 **Build:** a state diagram of the user `status` (`pending`, `active`, `blocked`, `deleting`, `deleted`) and a first ER/class diagram of the tables you know so far. Keep them in `docs/` (Mermaid is fine).
- ✅ **Done when:** each status transition on your diagram is linked to the endpoint or job that causes it.
- ❓ **Check yourself:**
  - Which transitions are allowed, and which must never happen (for example `deleted` → `active`)?

### 0.6 Idempotency

- 📖 **Read first:** `0.4 Idempotency.md` (whole file).
- 🛠 **Build:** nothing yet. Mark on your endpoint list which endpoints must be idempotent.
- ✅ **Done when:** you can explain which HTTP methods are safe and which are idempotent.
- ❓ **Check yourself:**
  - Why can a client send the same request twice even if the user clicked once?
  - What does an `Idempotency-Key` header protect against?

---

## Stage 1. Users table and registration

**Goal:** a guest can create an account with an email and password. Start with **email confirmation disabled**. Confirmation comes in Stage 6.

### 1.1 Study registration

- 📖 **Read first:** `1.0 Registration.md`, the Theory part (Model, Password, Email, Common Failures); `task.md` section 2, "Registration Specification".
- 🛠 **Build:** nothing yet. Write down the `users` table columns you will need, with types and constraints.
- ✅ **Done when:** your column list covers email, password hash, status, display name, photo key and timestamps, and you know which columns are unique.
- ❓ **Check yourself:**
  - Why is a password *hashed* and not *encrypted*?
  - What is a salt, and why doesn't it need its own column?
  - Why is there a maximum password length?

### 1.2 Users entity and migration

- 📖 **Read first:** `0.1 Databases.md` (Keys and Constraints, Indexes again); TypeORM docs on entities, column types and enums.
- 🛠 **Build:** a `User` entity in `src/modules/users`, and a migration that creates the `users` table with a unique email and a status enum.
- ✅ **Done when:** `migration:run` creates the table, `migration:revert` removes it, and inserting two users with the same email in your DB client fails.
- ❓ **Check yourself:**
  - Should email uniqueness be checked in code, in the database, or both? Why?
  - Why UUID for `id` instead of an auto-increment number?

### 1.3 Config for auth secrets

- 📖 **Read first:** `src/core/config/README.MD`; `task.md` section 1, "Cryptographic configuration".
- 🛠 **Build:** add the new variables to the config schema and `.env.example`: JWT secrets, issuer, audience, HMAC key, confirmation flags, bootstrap admin id. Secrets must be at least 32 bytes.
- ✅ **Done when:** the app refuses to start with a missing or short secret, and starts with valid ones.
- ❓ **Check yourself:**
  - Why is it better to fail at startup than at the first request?

### 1.4 Registration endpoint (confirmation disabled)

- 📖 **Read first:** `1.0 Registration.md`, Practical Assignment 1.3 to 1.6; NestJS docs "Validation" and "Pipes".
- 🛠 **Build:** an `auth` module with `POST /auth/register`: a DTO with validation (email normalization, password policy), password hashing with Argon2id (or bcrypt cost ≥ 12), and saving an `active` user.
- ✅ **Done when:**
  - a valid request returns **201** without the password or hash in the body;
  - an invalid email or weak password returns **400**;
  - `" User@Mail.com "` is stored as `user@mail.com`;
  - a second registration with the same email returns **409**, also when two requests arrive at the same time;
  - unknown fields in the body are dropped before reaching the service.
- ❓ **Check yourself:**
  - What happens if you catch the "email taken" case only in code and two requests arrive at once?
  - Where does normalization belong: DTO, service, or both?

### 1.5 Unified error format

- 📖 **Read first:** `task.md`, "Standardization of HTTP Responses and Error Codes"; NestJS docs "Exception filters".
- 🛠 **Build:** one consistent error body shape with the `code` values from the table (`bad_request`, `conflict`, …), applied globally.
- ✅ **Done when:** every error you can trigger so far returns the right status and `code`, and no stack traces leak.
- ❓ **Check yourself:**
  - Why should a database error never reach the client as is?

### 1.6 Tests for registration

- 📖 **Read first:** NestJS docs "Testing" (unit and e2e).
- 🛠 **Build:** unit tests for the password policy and normalization, plus e2e tests for the cases in 1.4.
- ✅ **Done when:** `npm run test` and `npm run test:e2e` pass.
- ❓ **Check yourself:**
  - What is the difference between a unit test and an e2e test, and what does each catch?

---

## Stage 2. RBAC: data model and bootstrap

**Goal:** roles and permissions exist in the database, the system creates them on first start, and new users get the `user` role.

### 2.1 Study RBAC

- 📖 **Read first:** `1.1 RBAC.md`, Theory part (Roles, Permissions, and Grants; Default Deny and Least Privilege; Dynamic Policy and Cache); `task.md` section 3.
- 🛠 **Build:** an ER diagram of the 7 RBAC tables and how they connect to `users`.
- ✅ **Done when:** you can explain each table and each `ON DELETE` rule (CASCADE vs RESTRICT).
- ❓ **Check yourself:**
  - What is the difference between authentication and authorization?
  - What does `all_actions = true` on a grant mean, and why is it useful?
  - Why is `user_roles.role_id` `RESTRICT` but `user_roles.user_id` `CASCADE`?

### 2.2 RBAC entities and migration

- 📖 **Read first:** TypeORM docs on relations, composite primary keys and foreign keys.
- 🛠 **Build:** entities and one migration for `roles`, `permissions`, `permission_actions`, `grants`, `grant_actions`, `user_roles`, `rbac_policy_state`.
- ✅ **Done when:** the migration runs and reverts cleanly, and all unique constraints and foreign keys are visible in your DB client.
- ❓ **Check yourself:**
  - Why is `rbac_policy_state` a table with only one row?

### 2.3 Bootstrap on startup

- 📖 **Read first:** `1.1 RBAC.md`, Practical Assignment; `task.md`, "Initial Initialization (Bootstrap) and the Administrator Invariant"; NestJS docs "Lifecycle events".
- 🛠 **Build:** when RBAC tables are empty at startup, create the permission catalog, the `user` and `admin` roles with their grants, assign `admin` to the configured bootstrap user, and give `user` to every active user without roles. All in one transaction.
- ✅ **Done when:** a fresh database gets the full catalog after the first start, a second start changes nothing, and the bootstrap admin has the `admin` role.
- ❓ **Check yourself:**
  - Why must bootstrap be one transaction?
  - What should happen if two app instances start at the same moment?

### 2.4 Assign the `user` role at registration

- 📖 **Read first:** `1.0 Registration.md`, Practical Assignment 1.1 (the part about RBAC).
- 🛠 **Build:** registration assigns the `user` role in the same transaction that creates the active user.
- ✅ **Done when:** every new active user has exactly one `user` role in `user_roles`.
- ❓ **Check yourself:**
  - What could go wrong if the role were assigned in a separate transaction?

---

## Stage 3. Authentication: login, tokens, cookies

**Goal:** a user can log in, get access and refresh cookies, refresh them, and log out.

### 3.1 Study authentication

- 📖 **Read first:** `1.2 Authentication.md`, Theory part (Password Login and a Neutral Error; JWT and Claims Verification; Access, Refresh, and Stateless Rotation; Cookies, CORS, and CSRF); `task.md` "Token Lifecycle and Cookie Management".
- 🛠 **Build:** nothing yet. Draw a sequence diagram of login → protected request → refresh → logout.
- ✅ **Done when:** you can explain every cookie attribute in the table (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path`).
- ❓ **Check yourself:**
  - Why are tokens in HttpOnly cookies and not in `localStorage`? (Think about XSS.)
  - Why are there two tokens with different lifetimes?
  - Why does the refresh cookie have `Path=/auth/refresh`?

### 3.2 Login with neutral errors

- 📖 **Read first:** `1.2 Authentication.md`, Practical Assignment (login part).
- 🛠 **Build:** `POST /auth/login`: normalize email, verify the password, reject inactive users, and return the same **401 `invalid_credentials`** for every failure. Do a dummy hash check when the user does not exist.
- ✅ **Done when:** wrong email, wrong password and inactive user all return the same response, with similar response times.
- ❓ **Check yourself:**
  - What is account enumeration, and how does a different error message enable it?
  - What is a timing attack, and how does the dummy hash prevent it?

### 3.3 Issue JWTs in cookies

- 📖 **Read first:** `1.2 Authentication.md` (JWT and Claims Verification); docs of the JWT library you choose; `@fastify/cookie` docs.
- 🛠 **Build:** on successful login, sign access and refresh tokens with their own secrets and claims (`sub`, `iss`, `aud`, `iat`, `exp`, `token_use`) and set them as cookies with the exact attributes from `task.md`.
- ✅ **Done when:** login returns the two `Set-Cookie` headers with the right attributes, and decoding the tokens (for example on jwt.io, with test secrets only) shows the right claims.
- ❓ **Check yourself:**
  - Why does each token have its own secret and a `token_use` claim?
  - What would happen if an access token were accepted at the refresh endpoint?

### 3.4 Refresh and logout

- 📖 **Read first:** `1.2 Authentication.md` (Access, Refresh, and Stateless Rotation); `0.4 Idempotency.md` (Safe and Idempotent HTTP Methods).
- 🛠 **Build:** `POST /auth/refresh` (verify the refresh token, check the user is active, issue a new pair, **204**) and `POST /auth/logout` (clear both cookies, always **204**).
- ✅ **Done when:** refresh works with a valid refresh cookie and fails with an expired or wrong one. Logout works even when you are not logged in.
- ❓ **Check yourself:**
  - Why is logout idempotent?
  - Refresh is stateless. What is the trade-off compared to storing refresh tokens in the database?

### 3.5 Rate limits

- 📖 **Read first:** `task.md` "Direct Login", Rate Limits; `src/core/throttler/throttler.module.ts`; `@nestjs/throttler` docs.
- 🛠 **Build:** 30 req/min per IP on login and refresh, and at most 5 failed logins per (email + IP) in 15 minutes.
- ✅ **Done when:** going over a limit returns **429 `rate_limit_exceeded`**.
- ❓ **Check yourself:**
  - Why limit per (email + IP) and not just per IP?
  - The service runs as several instances. Where must the counters live for limits to work across all of them?

---

## Stage 4. Authorization: the security chain

**Goal:** every endpoint is protected by default, and each request passes the 5-stage chain from `task.md`.

### 4.1 Study authorization

- 📖 **Read first:** `1.3 Authorization.md`, whole Theory part; `task.md` "Unified Security Chain" and "Security Requirements".
- 🛠 **Build:** nothing yet. Write down, for each of the 5 stages, which status code and error code it returns on failure.
- ✅ **Done when:** you can explain when to return 401, 403 and 503.
- ❓ **Check yourself:**
  - Why does the JWT hold the user's identity but not their roles?
  - What is "default deny", and what happens to a route someone forgot to annotate?

### 4.2 Authentication guard and `@Public()`

- 📖 **Read first:** NestJS docs "Guards", "Custom decorators", "Execution context", and the `Reflector`.
- 🛠 **Build:** a global guard that reads the access token from the cookie, verifies it (signature, `exp`, `iss`, `aud`, `token_use`), loads the user and requires `status = active`. A `@Public()` decorator opens a route. Mark register, login, refresh, logout and health as public.
- ✅ **Done when:** a new test endpoint returns **401** without a cookie and works with one. A blocked user gets **401** even with a valid token.
- ❓ **Check yourself:**
  - Why check the user in the database on every request if the token is already signed?

### 4.3 CSRF protection

- 📖 **Read first:** `1.2 Authentication.md` and `1.3 Authorization.md`, "Cookies, CORS, and CSRF".
- 🛠 **Build:** for cross-origin `POST`, `PUT`, `PATCH`, `DELETE`, check `Origin` against an allowlist and require `X-CSRF-Protection: 1`.
- ✅ **Done when:** a state-changing request from an unknown origin or without the header returns **403 `csrf_rejected`**.
- ❓ **Check yourself:**
  - What is CSRF, and why are cookies the reason it is possible?
  - Why doesn't `SameSite=Strict` alone make this check unnecessary?

### 4.4 Permission guard (`permission@action`)

- 📖 **Read first:** `1.1 RBAC.md` (Dynamic Policy and Cache); `1.3 Authorization.md` (Current RBAC and Default Deny).
- 🛠 **Build:** a decorator that declares the required `permission@action` on a route, and a guard that checks it against the user's permissions. Start by loading permissions from the database. The in-memory snapshot comes in Stage 5.
- ✅ **Done when:** a user without the permission gets **403 `permission_denied`**, and the app refuses to start (or returns 503) if a non-public route has no permission declared.
- ❓ **Check yourself:**
  - Why check at startup that every route is annotated?

### 4.5 Ownership check

- 📖 **Read first:** `1.4 Viewing User Data.md`, "IDOR, the Owner's Right, and `*_any`".
- 🛠 **Build:** a reusable way to compare the acting user with the resource owner, passing only if they match or the user has the `*_any` permission.
- ✅ **Done when:** you can show it working on a test route (it gets real use in Stage 7).
- ❓ **Check yourself:**
  - What is IDOR? Give an example with `GET /users/{id}`.
  - Why does 404 come *after* the permission check, not before?

---

## Stage 5. RBAC administrative API and live policy reload

**Goal:** admins can manage roles, permissions and grants, and changes apply without restarting.

### 5.1 Roles endpoints

- 📖 **Read first:** `1.1 RBAC.md`, Practical Assignment (roles part); `task.md` "Administrative API Specification".
- 🛠 **Build:** `GET`, `POST`, `PUT`, `DELETE /admin/rbac/roles`, protected by `rbac@manage`, with the name and description validation from the spec.
- ✅ **Done when:** all validation rules work, a duplicate name returns **409**, and deleting a role in use returns **409**.
- ❓ **Check yourself:**
  - Why is "an empty description becomes null" a normalization rule worth having?

### 5.2 Permissions endpoints

- 📖 **Read first:** `1.1 RBAC.md`, Practical Assignment (permissions part).
- 🛠 **Build:** `GET`, `POST`, `PUT`, `DELETE /admin/rbac/permissions` with their actions.
- ✅ **Done when:** removing an action used by a grant returns **409**, except for grants with `all_actions = true`.
- ❓ **Check yourself:**
  - Why can't you remove an action that a grant still uses?

### 5.3 Grants and user roles

- 📖 **Read first:** `1.1 RBAC.md`, Practical Assignment (grants and user roles).
- 🛠 **Build:** `/admin/rbac/grants` CRUD and `GET`/`PUT /admin/rbac/users/{userId}/roles`.
- ✅ **Done when:** an empty `actions` array creates an `all_actions` grant, and `PUT` with `roleIds` fully replaces the user's roles.
- ❓ **Check yourself:**
  - Why is `PUT` here a full replacement, and what does that mean for the client?

### 5.4 The super-admin invariant

- 📖 **Read first:** `task.md` "Super-administrator invariant"; `0.1 Databases.md` (Transactions and ACID).
- 🛠 **Build:** any change that would leave zero users with `rbac@manage` is rejected with **409** inside the transaction.
- ✅ **Done when:** removing the last admin's role, deleting the admin grant, or similar actions all return **409** and change nothing.
- ❓ **Check yourself:**
  - Why must this check run *inside* the same transaction as the change? What race does that prevent?

### 5.5 Policy version and in-memory snapshot

- 📖 **Read first:** `1.1 RBAC.md` (Dynamic Policy and Cache); `task.md` "Local Policy Snapshot and Dynamic Reload".
- 🛠 **Build:** every RBAC change increments `rbac_policy_state.version`. The service keeps the policy in memory, compares versions on each request, reloads when the database version is newer, and returns **503 `authorization_unavailable`** if reloading fails.
- ✅ **Done when:** an admin removes a permission and the very next request from that user is denied, without a restart. Stopping the database makes protected routes return **503**.
- ❓ **Check yourself:**
  - Why compare versions instead of reloading everything on each request?
  - What does "atomically replace the reference" mean, and why does it matter?
  - With two app instances, how does the second one learn about a change made through the first?

---

## Stage 6. Email confirmation (registration and login)

**Goal:** add the optional confirmation flows controlled by the two config flags.

### 6.1 Email sending

- 📖 **Read first:** `1.0 Registration.md` (Email; Common Failures).
- 🛠 **Build:** a small mail module behind an interface, with a local SMTP catcher for development (for example Mailpit in Docker Compose).
- ✅ **Done when:** the app can send a test email that you see in the catcher's web UI.
- ❓ **Check yourself:**
  - Why put the mail sender behind an interface?
  - If the SMTP server is down, which status code should the user get?

### 6.2 Registration challenges (OTP and magic link)

- 📖 **Read first:** `1.0 Registration.md`, Practical Assignment 1.3.2 and 1.4; `task.md` "Email Challenge Protocols" and "Challenge Tables".
- 🛠 **Build:** the `registration_challenges` table; with the flag on, registration creates a `pending` user and a challenge, stores only an HMAC of the secret, sends the email and returns **202**.
- ✅ **Done when:** the response never contains the code or token, and the database has only the hash.
- ❓ **Check yourself:**
  - Why HMAC and not a plain hash for a 6-digit code? (Think about how many codes exist.)

### 6.3 Confirm and resend

- 📖 **Read first:** same Practical Assignment sections.
- 🛠 **Build:** `POST /auth/register/confirm` (attempt limit, TTL, `consumed_reason`) and `POST /auth/register/resend` (60 s limit, replaces the old secret).
- ✅ **Done when:** the 5th attempt can still succeed, the 5th wrong one consumes the challenge, an expired code doesn't increment the counter, and an old code stops working after resend.
- ❓ **Check yourself:**
  - Why is confirmation a `POST` and never a `GET` link that changes state?

### 6.4 Two-step login

- 📖 **Read first:** `1.2 Authentication.md` (Email Challenge) and its Practical Assignment (login confirmation).
- 🛠 **Build:** with `LOGIN_EMAIL_CONFIRMATION_ENABLED`, login creates a `login_challenges` record and returns **202**; `POST /auth/login/confirm` sets the cookies.
- ✅ **Done when:** with the flag on, cookies appear only after confirmation; with it off, login works as in Stage 3.
- ❓ **Check yourself:**
  - Can you reuse code between registration and login challenges? What should stay separate?

---

## Stage 7. Viewing user data

**Goal:** `GET /users/{userId}` returns the Safe Profile, with ownership rules.

### 7.1 Study the safe profile

- 📖 **Read first:** `1.4 Viewing User Data.md`, whole Theory part; `task.md` "Safe Profile Contract".
- 🛠 **Build:** nothing yet.
- ✅ **Done when:** you can list the 7 fields and explain why each forbidden field must never leak.
- ❓ **Check yourself:**
  - Why map the entity to a DTO explicitly instead of returning the entity and hiding fields?

### 7.2 Get profile endpoint

- 📖 **Read first:** `1.4 Viewing User Data.md`, Practical Assignment.
- 🛠 **Build:** `GET /users/{userId}` with `users@read` / `users@read_any`, returning exactly the 7 fields.
- ✅ **Done when:** you can read your own profile, can't read others' as a normal user (**403 `ownership_denied`**), an admin can read anyone, and an unknown id returns **404** for an admin.
- ❓ **Check yourself:**
  - Why is `photoUrl` an API path and never the storage key?

---

## Stage 8. Storage adapter and changing user data

**Goal:** a user can change their profile and avatar. This stage also builds the storage layer that file transformation reuses later.

### 8.1 Study profile changes

- 📖 **Read first:** `1.5 Changing User Data.md`, whole Theory part.
- 🛠 **Build:** nothing yet.
- ✅ **Done when:** you can explain the email change flow and why the current session stays valid.
- ❓ **Check yourself:**
  - What is a field allowlist for `PATCH`, and what attack does it prevent?

### 8.2 Update display name

- 📖 **Read first:** `1.5 Changing User Data.md`, Practical Assignment (profile fields).
- 🛠 **Build:** `PATCH /users/{userId}` for `displayName`, with `users@update` / `users@update_any`.
- ✅ **Done when:** validation and normalization work, and fields not on the allowlist (like `status`) are ignored.
- ❓ **Check yourself:**
  - Why is `PATCH` used and not `PUT` here?

### 8.3 Change email with confirmation

- 📖 **Read first:** `1.5 Changing User Data.md` (Email Challenge and a Valid Session; Email Uniqueness and Races).
- 🛠 **Build:** changing email starts a confirmation for the new address. The email changes only after confirmation.
- ✅ **Done when:** the old email stays until confirmation, and a taken email returns **409**, even under a race.
- ❓ **Check yourself:**
  - Why confirm the new address before switching?

### 8.4 Storage adapter (local first)

- 📖 **Read first:** `2.4 Saving Transformation Results to Storage.md` (Storage Adapter; Private Key); `0.3 Back End Architectures.md` (Ports and Adapters).
- 🛠 **Build:** a `StorageAdapter` interface (put, get as a stream, delete) with a local-disk implementation, selected by config. The S3 adapter can come later in Stage 15.
- ✅ **Done when:** you can save, read and delete a file through the interface in a test.
- ❓ **Check yourself:**
  - Why random keys, and why never use the user's file name as the key?

### 8.5 Upload, get and delete avatar

- 📖 **Read first:** `1.5 Changing User Data.md` (Validating and Normalizing the Photo; Partial Storage and Mail Failures); `1.4 Viewing User Data.md` (The Photo and the Storage Boundary); `sharp` docs.
- 🛠 **Build:** `PUT /users/{userId}/photo` (check MIME type, strip EXIF, resize to max 1024×1024, convert to WebP), `GET /users/{userId}/photo` (stream with `image/webp`), `DELETE /users/{userId}/photo`.
- ✅ **Done when:** uploading a JPEG returns a WebP when fetched, a non-image returns **415**, and a file that is too big returns **413**.
- ❓ **Check yourself:**
  - Why remove EXIF data? What private information can it hold?
  - Why check the real file content and not only the extension or `Content-Type` header?

### 8.6 Storage cleanup jobs

- 📖 **Read first:** `1.5 Changing User Data.md` (Partial Storage and Mail Failures); `0.4 Idempotency.md` (Background Job Retries); NestJS docs "Task scheduling".
- 🛠 **Build:** when an avatar is replaced or deleted, add the old key to `storage_cleanup_jobs`; a background worker deletes those files and retries on failure.
- ✅ **Done when:** old files disappear from disk shortly after replacement, and the HTTP response doesn't wait for it.
- ❓ **Check yourself:**
  - Why not delete the old file directly inside the request?
  - What happens if the worker crashes halfway? Is it safe to run the job again?

---

## Stage 9. Deleting a user (background job)

**Goal:** account deletion as an idempotent, two-phase background process.

### 9.1 Study deletion

- 📖 **Read first:** `1.6 Deleting a User.md`, whole Theory part; `0.4 Idempotency.md` again (Idempotency Key); `task.md` "Asynchronous Account Deletion Protocol".
- 🛠 **Build:** a state/sequence diagram of the deletion flow.
- ✅ **Done when:** you can explain the three phases: ingestion, background execution, finalization.
- ❓ **Check yourself:**
  - Why is deletion asynchronous and returns **202** instead of **200**?
  - Why anonymize the user instead of deleting the row?

### 9.2 Ingestion phase

- 📖 **Read first:** `1.6 Deleting a User.md`, Practical Assignment (request and responses).
- 🛠 **Build:** `DELETE /users/{userId}` with `users@delete` / `users@delete_any` and an optional `Idempotency-Key`. In one transaction, set status `deleting` and create a job. Return **202** with `jobId`.
- ✅ **Done when:** a repeated call returns the same `jobId`, the user can no longer use their session, and deleting the last admin returns **409**.
- ❓ **Check yourself:**
  - Why does access stop right away, even though the JWT is still valid?

### 9.3 Deletion worker and erasers

- 📖 **Read first:** `1.6 Deleting a User.md` (The Module Cleanup Contract; Anonymization and the Unique Email; Errors and Process Recovery).
- 🛠 **Build:** a worker that runs the erasers (avatar, personal data, data purge) and then sets status `deleted` in a transaction.
- ✅ **Done when:** after the worker runs, the email is masked, display name is null, the avatar file is gone, challenges are cleared, and status is `deleted`. Running it again does no harm.
- ❓ **Check yourself:**
  - Why give each module its own eraser instead of one big function?
  - Why is the masked email random, and why does it use the `.invalid` domain?

---

## Stage 10. Administrative user list

**Goal:** `GET /admin/users` with safe keyset pagination, filters and search.

### 10.1 Study pagination

- 📖 **Read first:** `1.7 Viewing the List of All Users.md`, whole Theory part; `0.1 Databases.md` (Indexes).
- 🛠 **Build:** nothing yet.
- ✅ **Done when:** you can explain why offset pagination breaks when rows are added, and how `(created_at, id)` fixes it.
- ❓ **Check yourself:**
  - Why is `id` part of the cursor and not only `created_at`?
  - What does `snapshotAt` protect against?

### 10.2 Keyset pagination with a signed cursor

- 📖 **Read first:** `1.7 Viewing the List of All Users.md`, Practical Assignment (Cursor Pagination and a Total Order; Cursor Integrity).
- 🛠 **Build:** `GET /admin/users` with `users@list`, a cursor signed with HMAC, and `snapshotAt`.
- ✅ **Done when:** paging returns every user exactly once, even if users register while you page, and a tampered cursor returns **400**.
- ❓ **Check yourself:**
  - Why sign the cursor if it contains no secret data?

### 10.3 Filters, search and indexes

- 📖 **Read first:** `1.7 Viewing the List of All Users.md` (Search and Filter Whitelist; Search, Indexes, and the Query Plan).
- 🛠 **Build:** the allowlisted filters (`status`, `created_after`, `created_before`, `search`) and the indexes they need.
- ✅ **Done when:** unknown filters are rejected, and `EXPLAIN` shows your indexes being used.
- ❓ **Check yourself:**
  - Why is building SQL from user input dangerous, and how does your code avoid it?

---

## Stage 11. File transformation: common foundation

**Goal:** a shared base for all file transformations: upload limits, streaming, timeouts, history records.

### 11.1 Study the general requirements

- 📖 **Read first:** `2.0 General Requirements for File Transformation.md`, whole file; `task.md` section 5, "Converter Core Engine Constraints".
- 🛠 **Build:** nothing yet. Design the transformer interface and the history table on paper.
- ✅ **Done when:** you can explain streaming and why the whole file must not be loaded into memory.
- ❓ **Check yourself:**
  - What happens to a server's memory if 50 users upload 100 MB files at once without streaming?
  - Why use well-known libraries instead of writing your own parsers?

### 11.2 File upload and limits

- 📖 **Read first:** `@fastify/multipart` docs; Node.js docs on streams and `pipeline`.
- 🛠 **Build:** multipart upload handling with a size limit, an allowlist of types, and a 30-second timeout.
- ✅ **Done when:** an oversized file returns **413**, a wrong type **415**, and a slow operation **504**.
- ❓ **Check yourself:**
  - Why check the size while streaming instead of after the upload finishes?

### 11.3 History table and transformer interface

- 📖 **Read first:** `2.0 General Requirements…` (The Transformer Interface; History and Audit).
- 🛠 **Build:** a history entity and migration, and the common transformer interface that each converter will implement.
- ✅ **Done when:** a dummy transformer can run through the pipeline and write a history record.
- ❓ **Check yourself:**
  - What must happen to a user's history when the user is deleted? (See `2.0`, User Deletion.)

---

## Stage 12. Text format transformation

**Goal:** `POST /api/convert` for the 12 CSV / JSON / XML / YAML directions.

### 12.1 Study text formats

- 📖 **Read first:** `2.1 Text Format Transformation.md`, Theory part.
- 🛠 **Build:** choose one library per format and note why.
- ✅ **Done when:** you can explain XXE and unsafe YAML loading.
- ❓ **Check yourself:**
  - What can an attacker do with an XML external entity?
  - Why can't every JSON document be turned into CSV without rules?

### 12.2 Converters one pair at a time

- 📖 **Read first:** `2.1 Text Format Transformation.md`, Practical Assignment.
- 🛠 **Build:** start with CSV → JSON, then add the others one by one. Each converter streams where the format allows, and is safe (no XXE, no DTD, safe YAML).
- ✅ **Done when:** all 12 directions work, an XXE sample is rejected, and broken input returns **400**.
- ❓ **Check yourself:**
  - How can you avoid writing 12 separate converters? (Hint: think of a common in-between form.)

### 12.3 Formats registry endpoint

- 📖 **Read first:** `task.md` "Format Registry and Operation History".
- 🛠 **Build:** `GET /api/convert/formats` returning the supported directions.
- ✅ **Done when:** the list comes from the same source the converter uses, not a second hardcoded list.
- ❓ **Check yourself:**
  - Why is a single source of truth important here?

---

## Stage 13. Image transformation

**Goal:** `POST /api/images/convert` for PNG, JPEG and SVG input.

### 13.1 Study images

- 📖 **Read first:** `2.2 Image Transformation.md`, Theory part.
- 🛠 **Build:** nothing yet.
- ✅ **Done when:** you can explain raster vs vector, and why SVG is dangerous.
- ❓ **Check yourself:**
  - What is a decompression bomb, and how do you defend against it?

### 13.2 Raster conversion

- 📖 **Read first:** `2.2 Image Transformation.md`, Practical Assignment; `sharp` docs (limits, `flatten`, metadata).
- 🛠 **Build:** PNG ↔ JPEG with a 4096×4096 limit, EXIF removal, configurable JPEG quality, and flattening transparency on white.
- ✅ **Done when:** a too-large image returns **400**, a transparent PNG becomes a JPEG with a white background, and output has no EXIF.
- ❓ **Check yourself:**
  - Why check the dimensions *before* fully decoding the image?

### 13.3 Safe SVG rasterization

- 📖 **Read first:** `2.2 Image Transformation.md` (Safe SVG); `task.md` "SVG Script Execution".
- 🛠 **Build:** sanitize SVG (remove scripts, event handlers and external URIs), then rasterize it.
- ✅ **Done when:** an SVG with `<script>` or `onload=` is cleaned or rejected, and an external image link is never fetched.
- ❓ **Check yourself:**
  - Why is SVG only accepted as input, never produced as output?

### 13.4 Image formats endpoint

- 📖 **Read first:** `task.md` "Format Registry".
- 🛠 **Build:** `GET /api/images/convert/formats`.
- ✅ **Done when:** it matches what the converter really supports.

---

## Stage 14. Transformation history

**Goal:** `GET /api/transformations/history` with the same pagination ideas as Stage 10.

### 14.1 History endpoint

- 📖 **Read first:** `2.3 Viewing User File Transformation History.md`, whole file.
- 🛠 **Build:** history with `transformations@history` (own) and `transformations@history_any` (everyone), keyset pagination, a signed cursor and `snapshotAt`.
- ✅ **Done when:** a user sees only their own items, an admin can see all, and paging is stable.
- ❓ **Check yourself:**
  - Can you reuse your pagination code from Stage 10? What did you have to change?

---

## Stage 15. Saving results to storage and retention

**Goal:** `save=true` keeps results, users can download them, and old results are cleaned up.

### 15.1 Save results in the background

- 📖 **Read first:** `2.4 Saving Transformation Results to Storage.md` (Background Saving; Partial Failures).
- 🛠 **Build:** with `save=true`, store the result through the `StorageAdapter` under a random key and link it to the history item.
- ✅ **Done when:** saved results appear in storage and the history item shows its saved state, including failures.
- ❓ **Check yourself:**
  - What should the history show if the conversion worked but saving failed?

### 15.2 Secure download

- 📖 **Read first:** `2.4 Saving Transformation Results…` (Downloading and IDOR).
- 🛠 **Build:** `GET /api/transformations/history/{itemId}/download` with `download` / `download_any`, streaming with `Content-Type` and `Content-Disposition`.
- ✅ **Done when:** you can download your own files, not others' (unless admin), and nothing reveals the storage key.
- ❓ **Check yourself:**
  - Why must `Content-Disposition` be built carefully from the file name?

### 15.3 S3 adapter

- 📖 **Read first:** `2.4 Saving Transformation Results…` (Storage Adapter); AWS SDK v3 S3 docs; MinIO docs for local testing.
- 🛠 **Build:** an S3-compatible adapter behind the same interface, chosen by config. Test locally with MinIO in Docker Compose.
- ✅ **Done when:** switching config from local to S3 changes nothing in the rest of the code, and all features still work.
- ❓ **Check yourself:**
  - What did the adapter pattern save you from here?

### 15.4 Retention worker

- 📖 **Read first:** `2.4 Saving Transformation Results…` (Retention); `2.3 …History` (Retention).
- 🛠 **Build:** a daily worker that deletes saved results older than 90 days and updates their history status.
- ✅ **Done when:** with a test that fakes old dates, the files disappear and the history shows they expired.
- ❓ **Check yourself:**
  - How do you test a job that runs once every 24 hours without waiting 24 hours?

---

## Stage 16. Final hardening and review

**Goal:** make sure the whole service meets the spec and you can defend every decision.

### 16.1 Spec checklist

- 📖 **Read first:** [`task.md`](./task.md) again, the whole file, now that you have built it.
- 🛠 **Build:** go through `task.md` line by line and tick off each requirement, with a link to the code or test that proves it.
- ✅ **Done when:** every requirement is ticked or has a written reason agreed with your mentor.

### 16.2 Security review

- 📖 **Read first:** "Common Failures" sections in each theory file.
- 🛠 **Build:** check default-deny, error masking, DTO stripping, XXE, decompression bombs, SVG, CSRF, IDOR, and that no secrets or hashes leak in responses or logs.
- ✅ **Done when:** each item has a test or a manual check you can show.

### 16.3 Readiness and failure behaviour

- 📖 **Read first:** `src/core/health/README.MD`; `task.md` (503 and readiness rules).
- 🛠 **Build:** readiness reports `false` when config is invalid, the database is down, or a route lacks an access declaration.
- ✅ **Done when:** you can show the 503 cases from the error table.

### 16.4 Prepare for the final review

- 📖 **Read first:** the "Theory Questions" section at the end of each theory file.
- 🛠 **Build:** answer all the Theory Questions in your own words. Update your diagrams so they match the final code.
- ✅ **Done when:** you can explain any part of the code without notes. Ask me for a mock review.

---

*Need help on a step? Ask me for a hint first, then a deeper explanation if you need it. When a step is done, ask me to review it.*
