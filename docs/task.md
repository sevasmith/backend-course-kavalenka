Technical Specification for the Development of a Backend Service for Authentication, User Management, and File Transformation

1. GENERAL SYSTEM AND ARCHITECTURAL REQUIREMENTS

The service is designed as a strictly isolated monolithic HTTP REST API application on the NestJS platform (Node.js / TypeScript), deployed as an independent stateless process. The architectural strategy of combining the authentication, access control, profile management, and file processing modules within a single monolithic boundary is driven by the need to ensure atomic transactional data integrity, minimal latency in inter-module communication, and the elimination of distributed state. The PostgreSQL database is the sole transactional source of truth; the use of third-party in-memory caches without built-in version control is strictly prohibited. The absence of session state in process memory (a stateless architecture based on cryptographic JWTs) and the abstraction of the file layer through a dual adapter model make it possible to scale the service by running identical application instances behind an L7 load balancer. In this topology, a single end-to-end security chain serves as the baseline protection perimeter, ensuring absolute denial of access by default (default-deny) and preventing Cross-Site Request Forgery (CSRF) attacks, unauthorized reading of personal data, and exhaustion of the application's computing resources.

Architectural Specification and Technology Stack

The application's technology stack and system constraints are strictly governed by the following components:

* Architectural pattern: Monolithic HTTP REST API (NestJS / TypeScript).
* Relational database: PostgreSQL. Serves as the single store for system entities, user accounts, roles, permissions, and operation history.
* File storage layer (StorageAdapter): Dual-adapter file storage design:
  * Local disk adapter (local-storage): used exclusively in local development environments and on test stands.
  * S3-compatible adapter (s3-storage): used in the production environment (S3-compatible object storage).
* Cryptographic configuration: The application's secret keys (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, LOGIN_CHALLENGE_HMAC_KEY) must each be at least 32 bytes (256 bits) long. If any of the keys is missing or does not reach the specified length, the application initialization procedure is blocked, and the system readiness indicator is set to readiness = false with an emergency process shutdown.

Unified Security Chain

Every protected incoming HTTP request must sequentially pass through a 5-stage verification pipeline before control is handed over to the controller and the business handler:

1. Extraction and cryptographic validation of the JWT (access_token): The token is extracted strictly from the HttpOnly cookie access_token. The digital signature is validated (HS256 algorithm with the JWT_ACCESS_SECRET key), and the timestamps (iat, exp), issuer (iss = JWT_ISSUER), audience (aud = JWT_AUDIENCE), and token type (token_use = "access") are checked.
2. Verification of the subject's existence and status: The user identifier (userId) extracted from the sub claim is looked up in PostgreSQL. The system verifies that the account exists and that its attribute is status = active. Any other status (pending, blocked, deleting, deleted) results in immediate termination of the request.
3. CSRF protection: For all state-changing requests (POST, PUT, PATCH, DELETE) arriving from third-party origins (cross-origin), the Origin header is mandatorily checked against an allowlist of permitted domains, and the presence of the custom header X-CSRF-Protection: 1 is verified.
4. RBAC permission check: The permission@action combination required by the controller is matched against the current in-memory snapshot of the user's permissions (in-memory policy snapshot).
5. Resource ownership check (Ownership Check): For operations on personal resources, actorUserId is compared with the resource owner's identifier. If they do not match, the check passes only if the subject holds an administrative permission with the *_any suffix (for example, users@read_any).

Standardization of HTTP Responses and Error Codes

| HTTP status code | Error code (Code) | Conditions of occurrence and semantics |
| --- | --- | --- |
| 400 Bad Request | bad_request | DTO validation error, invalid file format, failure to comply with the password policy, exceeding the allowed image resolution (max 4096x4096px), or an invalid/expired OTP/Magic Link token. |
| 401 Unauthorized | invalid_session / invalid_credentials | Missing or invalid access token, expired session, inactive user status (pending, blocked, deleting, deleted), or invalid credentials at login. |
| 403 Forbidden | permission_denied / ownership_denied / csrf_rejected | Insufficient RBAC permissions, failed resource ownership check in the absence of *_any permissions, mismatched or missing CSRF headers. |
| 404 Not Found | not_found | The requested resource, user, or file does not exist (returned strictly after successfully passing RBAC authorization). |
| 409 Conflict | conflict | Violation of DB uniqueness constraints (duplicate email, role name, grant), an active account deletion job already exists, or an attempt to reduce the number of administrators with rbac@manage to zero. |
| 413 Payload Too Large | payload_too_large | The maximum allowed size of the request body or uploaded file is exceeded. |
| 415 Unsupported Media Type | unsupported_media_type | A file is submitted with a MIME type or extension that is not on the allowlist of permitted formats. |
| 429 Too Many Requests | rate_limit_exceeded | Request rate limits (Rate Limit) exceeded, email resend blocked until 60 seconds have elapsed, or OTP entry attempts exhausted. |
| 503 Service Unavailable | authorization_unavailable / service_unavailable | Unavailability of the PostgreSQL database, S3 storage, or SMTP server, or a failure to load/refresh the local RBAC policy snapshot. The route is blocked. |
| 504 Gateway Timeout | gateway_timeout | The hard execution time limit for a file transformation operation is exceeded (>30 seconds). |

Security Requirements and Threat Mitigation

* Default-Deny principle: All API endpoints are protected by default. Access is opened exclusively when an explicit @Public() decorator is present. Any routes without an access decorator or without a declared permission@action pair are blocked at application startup, with the readiness indicator set to readiness = false, or abort processing with a 503 Service Unavailable code.
* Error Masking: Responses from authentication systems and infrastructure failures must be neutral. It is forbidden to disclose whether an email exists in the system during login and registration, to prevent Account Enumeration attacks.
* DTO Whitelisting: Incoming data structures are subject to strict validation. Fields not described in the DTO are automatically discarded (stripping) before reaching the business layer.
* Payload Attack Protection:
  * XXE (XML External Entity): Loading of external entities and DTD structures is forcibly disabled in XML parsers.
  * Decompression Bombs: While decompressing archives and media files, the amount of allocated memory is inspected and the compression ratio is limited.
  * SVG Script Execution: Rasterization of SVG images is performed in an isolated environment after strict prior removal of `<script>` tags, inline event handlers (e.g., `onload=`), and external URIs.

The designed architectural constraints and security pipeline form the baseline platform for the operation of the system's business modules, the first of which is the Authentication and Identification Module.

2. AUTHENTICATION AND IDENTIFICATION MODULE

The authentication module ensures reliable establishment of user identity, guaranteeing a balance between high security standards (stateless JWT in an HttpOnly cookie, Argon2id/bcrypt hashing algorithms, rate limiting, HMAC protection of secrets) and user convenience (support for one-time passwords (OTP) and Magic Links).

Registration Specification (POST /auth/register)

1. Input data processing:
  * email: mandatory trimming of leading/trailing whitespace (trim) and conversion to lowercase (lowercase).
  * password: length validation (minimum 8 characters), mandatory presence of at least one letter of any alphabet and one digit. An upper bound on password length is introduced (no more than 128 characters) to prevent CPU resource exhaustion attacks and to rule out bcrypt truncation at the 72nd byte.
2. Password hashing:
  * The Argon2id algorithm (preferred) or bcrypt with a cost factor of cost >= 12 is used. A salt is generated automatically for each password and embedded into the resulting hash string.
3. Email confirmation modes (controlled by the REGISTRATION_EMAIL_CONFIRMATION_ENABLED flag):
  * Confirmation disabled: A user record with status active is created transactionally in the DB. In the same transaction, the user is assigned the user role (if the RBAC module is initialized). 201 Created is returned with the Safe Profile DTO.
  * Confirmation enabled: A record with status pending is created in the DB. A record is generated in the registration_challenges table. The client receives 202 Accepted with the structure: confirmationRequired: true, method: "otp" | "magic_link", attemptId, expiresInSeconds: 600, resendAfterSeconds: 60. The secret code or token is never included in the response body.

Email Challenge Protocols

* OTP (One-Time Password): A 6-digit numeric code with a time-to-live (TTL) of 10 minutes. The maximum number of entry attempts is 5 (the 5th attempt may succeed). The code is stored in the DB exclusively as an HMAC-SHA256 (secret_hash) computed using LOGIN_CHALLENGE_HMAC_KEY. The fifth incorrect entry consumes the attempt, recording consumed_reason = attempts_exhausted.
* Magic Link: A token of 32 random bytes (base64url-encoded) with a TTL of 10 minutes, delivered to the client in the format attemptId.secret. The DB stores an HMAC-SHA256 of the token. Confirmation is performed strictly via POST /auth/register/confirm. GET requests via links are strictly prohibited from changing system state, to prevent one-time tokens from being burned by mail server scanners.
* Resend (POST /auth/register/resend): Rate-limited to no more than once every 60 seconds. Invalidates the previous secret (consumed_reason = replaced), resets the attempt counter, and restarts the 10-minute TTL.

Direct Login (POST /auth/login) and Login Confirmation

1. Rate Limits:
  * A hard limit is set for POST /auth/login: no more than 30 requests per minute from a single IP address and no more than 5 failed login attempts per (email + IP) pair within 15 minutes.
2. Credential validation: Email normalization, comparison of the entered password with password_hash from the DB.
3. Timing attack protection and neutral errors: If the email is not in the DB, the password is incorrect, or the account status is inactive (pending, blocked, deleting, deleted), the system returns an identical 401 Unauthorized response with the code invalid_credentials. If the user is not found in the DB, the system must perform a dummy hash check (dummy password hash verification) using a pre-generated reference hash to equalize the API response time.
4. Two-step login (if LOGIN_EMAIL_CONFIRMATION_ENABLED = true): A record is generated in login_challenges (otp or magic_link), an email is sent, and 202 Accepted is returned. Confirmation via POST /auth/login/confirm checks limits and user status, consumes the challenge, and sets the authentication cookies.

Challenge Tables and Consumption Status

The registration_challenges and login_challenges tables contain a mandatory consumed_reason column with a strict list of enum values:

* confirmed — the attempt was successfully confirmed;
* replaced — the secret was invalidated by a resend call (resend);
* attempts_exhausted — the limit of 5 incorrect OTP entries has been exhausted;
* user_inactive — the user was moved to an inactive status before confirmation.

Token Lifecycle and Cookie Management

| Parameter / Characteristic | Access Token (access_token) | Refresh Token (refresh_token) |
| --- | --- | --- |
| Time to live (TTL) | 15 minutes | 30 days |
| Set of claims in the payload | sub, iss, aud, iat, exp, token_use: "access" | sub, iss, aud, iat, exp, token_use: "refresh" |
| Signing algorithm and key | HS256 / JWT_ACCESS_SECRET (>= 32 bytes) | HS256 / JWT_REFRESH_SECRET (>= 32 bytes) |
| Delivery method | HttpOnly Cookie | HttpOnly Cookie |
| Cookie attributes | HttpOnly; Secure; SameSite=Strict; Path=/ | HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh |

* Refresh semantics (POST /auth/refresh): Rate-limited to 30 requests per minute per IP. Implements token rotation without storing state (stateless). Verifies the signature and lifetime of the refresh token and that the user exists in the DB with status active. On success, generates and sets a new pair of cookies (204 No Content).
* Logout semantics (POST /auth/logout): Idempotently clears both cookies (access_token, refresh_token), returning to the client a Set-Cookie header with a past date and matching Path/SameSite attributes. Always returns 204 No Content.

The issued and confirmed authentication tokens pass the user identifier context (userId) to the Access Control Module (RBAC) for making authorization decisions.

3. ACCESS CONTROL MODULE (RBAC)

The dynamic role-based access control (RBAC) system provides centralized enforcement of the principle of least privilege. The module guarantees hot reloading of permission configurations without system downtime (zero-downtime) and absolute blocking of unauthorized actions.

Relational Data Model Schema

The RBAC data model consists of 7 mandatory tables with strict enforcement of foreign key integrity:

* roles: id (UUID, PK), name (text, Unique, normalized), description (text, max 500 chars, null), created_at, updated_at.
* permissions: id (UUID, PK), name (text, Unique, e.g., users), description (text, max 500 chars, null), created_at, updated_at.
* permission_actions: id (UUID, PK), permission_id (UUID, FK -> permissions.id ON DELETE CASCADE), name (text, e.g., read, update). Unique constraint on the pair (permission_id, name).
* grants: id (UUID, PK), role_id (UUID, FK -> roles.id ON DELETE CASCADE), permission_id (UUID, FK -> permissions.id ON DELETE CASCADE), all_actions (boolean), created_at, updated_at. Unique constraint on the pair (role_id, permission_id).
* grant_actions: grant_id (UUID, FK -> grants.id ON DELETE CASCADE), permission_action_id (UUID, FK -> permission_actions.id ON DELETE RESTRICT). Composite primary key (grant_id, permission_action_id).
* user_roles: user_id (UUID, FK -> users.id ON DELETE CASCADE), role_id (UUID, FK -> roles.id ON DELETE RESTRICT). Composite primary key (user_id, role_id).
* rbac_policy_state: id (integer, PK, a single row id=1), version (bigint, a monotonically increasing counter), updated_at (timestamptz).

Local Policy Snapshot and Dynamic Reload (Snapshot Reload)

1. The service maintains a full snapshot of access policies (roles, permissions, actions, user assignments) in the process's RAM.
2. When processing a request, the service compares the version of the local snapshot with the value of rbac_policy_state.version in PostgreSQL.
3. If the version in the DB is greater than the local one, the process holds execution, loads a new snapshot from the DB, validates the integrity of the permission graph, and atomically replaces the reference to the local snapshot.
4. If loading fails or the snapshot is invalid, the service blocks processing of protected routes, returning a 503 Service Unavailable error (authorization_unavailable).

Complete Catalog of System Permissions and Actions

The set of system permissions and actions is strictly limited to the following list:

* Permission users: actions read, read_any, update, update_any, delete, delete_any, list.
* Permission transformations: actions convert, history, history_any, download, download_any.
* Permission rbac: action manage.

Initial Initialization (Bootstrap) and the Administrator Invariant

* Initialization (Bootstrap): Performed automatically at application startup when the RBAC tables are empty. Creates the permissions (rbac, users, transformations) and their actions. Generates the user and admin roles. The user role is granted users@read, users@update, users@delete. The admin role is granted rbac@manage and absolutely all actions of the users and transformations permissions. The user with the ID from the RBAC_BOOTSTRAP_ADMIN_USER_ID configuration is assigned the admin role. All existing active users without roles receive the user role in the same transaction.
* Super-administrator invariant: Any administrative operation (changing roles, revoking permissions, deleting users) whose execution would leave 0 users with the rbac@manage permission in the system must be rejected transactionally with a 409 Conflict response.

Administrative API Specification (/admin/rbac/*)

| Endpoint | Method | Request body / Parameters | Validation and error handling |
| --- | --- | --- | --- |
| /admin/rbac/roles | GET | — | Returns an array of all roles. |
| /admin/rbac/roles | POST | name: string, description?: string | name from 1 to 64 characters (^[a-z][a-z0-9._-]{0,63}$). description max 500 chars (an empty string is reduced to null). |
| /admin/rbac/roles/{roleId} | PUT | name: string, description?: string | Full replacement of the role's fields. Validation is the same as for POST. |
| /admin/rbac/roles/{roleId} | DELETE | — | Rejected with 409 Conflict if the role is assigned to users or has active grants. |
| /admin/rbac/permissions | GET | — | Returns a list of all permissions with their actions. |
| /admin/rbac/permissions | POST | name: string, description?: string, actions: string[] | actions contains from 1 to 64 unique strings. |
| /admin/rbac/permissions/{permissionId} | PUT | name: string, description?: string, actions: string[] | Updates the permission. Removing an action linked to grant_actions returns 409 Conflict. If a role has all_actions = true assigned, the action is removed seamlessly without a conflict. |
| /admin/rbac/permissions/{permissionId} | DELETE | — | Rejected with 409 Conflict if there are linked grants. |
| /admin/rbac/grants | GET | — | Returns a list of all permission grants to roles. |
| /admin/rbac/grants | POST | roleId: UUID, permissionId: UUID, actions?: string[] | An empty actions array sets all_actions = true. |
| /admin/rbac/grants/{grantId} | PUT | roleId: UUID, permissionId: UUID, actions?: string[] | Full update of the permission grant. |
| /admin/rbac/grants/{grantId} | DELETE | — | Deletes the permission grant. |
| /admin/rbac/users/{userId}/roles | GET | — | Retrieves the array of the user's role IDs. |
| /admin/rbac/users/{userId}/roles | PUT | roleIds: UUID[] | Full replacement of the user's role array. Passing an empty array removes all roles. Checking the rbac@manage invariant is mandatory. |

The designed access control system ensures the security of operations on user entities, which are governed by the User and Profile Management Module.

4. USER AND PROFILE MANAGEMENT MODULE

The module manages the lifecycle of user profiles and avatars, ensures correct handling of personal data, and provides mechanisms for asynchronous anonymized deletion of user accounts.

Safe Profile Contract

External API responses containing user data are subject to strict projection onto the Safe Profile DTO, consisting of exactly 7 fields:

1. id (UUID)
2. email (string, normalized)
3. displayName (string | null)
4. photoUrl (string | null) — the URL of the API endpoint (/users/{userId}/photo), completely excluding the internal S3 key
5. status ("pending" | "active" | "blocked" | "deleting" | "deleted")
6. createdAt (string, ISO 8601)
7. updatedAt (string, ISO 8601)

It is strictly forbidden to include password hashes, HMAC secrets, storage keys (photo_key), internal versions, or JWTs in the DTO.

Profile and Avatar Operations

* GET /users/{userId}: Requires the users@read permission. If targetUserId != actorUserId, the users@read_any permission is required. Returns the Safe Profile DTO.
* PATCH /users/{userId}: Requires users@update (users@update_any when changing another user's profile). Updates text fields (displayName). When the email is changed, a two-step confirmation process for the new address is started, preserving the current session.
* PUT /users/{userId}/photo & DELETE /users/{userId}/photo: Uploading and deleting the avatar.
  * Upload pipeline: Image MIME type check, removal of EXIF metadata, resizing, and conversion to WebP format (maximum 1024x1024 px).
  * Storage cleanup: When the avatar is replaced or deleted, the previous file is deleted asynchronously — a record with the key of the obsolete file is placed into the storage_cleanup_jobs DB table for background disposal by a worker, preventing the HTTP response from being blocked.
* GET /users/{userId}/photo: Returns the binary image stream with the header Content-Type: image/webp.

Asynchronous Account Deletion Protocol (DELETE /users/{userId})

The full account deletion operation is designed as a two-phase asynchronous scheme that eliminates HTTP connection timeouts and guarantees idempotent execution.

1. Request Ingestion and Validation Phase (Ingestion Phase)

* The client sends a DELETE /users/{userId} request with an optional Idempotency-Key header (16 random bytes as 32 hex characters).
* The server checks the permissions (users@delete or users@delete_any) and whether deletion processes are already running.
* Within a single DB transaction:
  * The user's status is set to deleting.
  * A deletion job is created with a jobId equal to the Idempotency-Key value (if the key is not provided, the jobId is generated by the server).
* The server immediately returns a 202 Accepted response with the structure `{ "jobId": "<32_hex_chars>", "status": "deleting" }`.

2. Background Execution Phase

The background cleanup worker (deletion-worker) periodically fetches jobs in the deleting status and sequentially runs modular erasers:

* Avatar Eraser: Calls the delete() method of the StorageAdapter to remove the avatar file from S3 or the local disk.
* Personal Data Eraser: Anonymizes the user's personal data in the users table. The email field is overwritten with the mask `deleted.<32_hex_random>@example.invalid`, and the displayName field is reset to null.
* Data Purge Eraser: Clears all active challenges (registration_challenges, login_challenges), related tokens, and session history.

3. Finalization and Guaranteed Idempotency (Finalization Phase)

* Once all erasers have finished, the user's status in the DB is transactionally set to deleted.
* Repeated DELETE /users/{userId} calls with the same or a new Idempotency-Key do not create duplicate jobs, are idempotent, and return the existing jobId and the current processing status.

Administrative User List (GET /admin/users)

* Safe pagination (Keyset Pagination): Cursor-based pagination over the composite tuple (created_at, id) is used.
* Cursor protection: The opaque cursor token passed to the client is encrypted/signed using HMAC to prevent client-side tampering with pagination parameters.
* Fixed time snapshot (snapshotAt): The request accepts or generates a snapshotAt timestamp that eliminates page shifting (pagination drift) when new users are added during iteration.
* Filtering: A strict allowlist of filters (status, created_after, created_before, substring search via search over email and displayName).

Profile and account management is complemented by user data processing functionality, described in detail in the File Transformation and Storage Module.

5. FILE TRANSFORMATION AND STORAGE MODULE

The module provides streaming transformation of text and media files, strict control of RAM consumption, protection against attack vectors via uploaded content, and temporary or permanent storage of processing results.

Converter Core Engine Constraints

* Streaming processing: File conversion is performed strictly through a stream pipeline (streaming processing) without loading the entire file into RAM.
* Execution timeout: A hard execution time limit of 30 seconds is set for an operation. If exceeded, the process is aborted and a 504 Gateway Timeout code is returned.
* Size control: Exceeding the global input file size limit is blocked with a 413 Payload Too Large code.

Text Format Conversion Engine (POST /api/convert)

* Required permission: transformations@convert.
* Matrix of supported directions: The engine strictly supports 12 explicit conversion paths between the CSV, JSON, XML, and YAML formats:
  1. CSV -> JSON
  2. CSV -> XML
  3. CSV -> YAML
  4. JSON -> CSV
  5. JSON -> XML
  6. JSON -> YAML
  7. XML -> CSV
  8. XML -> JSON
  9. XML -> YAML
  10. YAML -> CSV
  11. YAML -> JSON
  12. YAML -> XML
* Security requirements:
  * YAML: Safe parsing with the ability to instantiate arbitrary DTOs and code objects completely disabled.
  * XML: Strict disabling of external entity processing (anti-XXE) and DTD structures.

Image Conversion Engine (POST /api/images/convert)

* Required permission: transformations@convert.
* Supported formats: PNG, JPEG, SVG (only as an input format for rasterization).
* Size constraints: The maximum resolution of input and output images is 4096x4096px. If the limit is exceeded, processing is blocked with a 400 Bad Request code.
* Attack protection: Protection against "decompression bombs" (zip/image bombs) by controlling buffer size during decoding.
* Privacy and processing: Automatic removal of all EXIF metadata, configurable JPEG quality parameters, forced flattening of the alpha transparency channel onto a white background when converting transparent images to non-transparent formats (e.g., PNG -> JPEG).

Format Registry and Operation History

* GET /api/convert/formats and GET /api/images/convert/formats: Return the matrix of supported transformation directions.
* GET /api/transformations/history: Requires the transformations@history permission (or transformations@history_any to view the global history). Returns a list of the user's past operations with cursor-based pagination over the tuple (created_at, id), an HMAC-signed cursor, and a snapshotAt parameter.

Storage Persistence and Retention Policy

* Long-term persistence flag (save=true): If the save=true parameter is present in a transformation request, the processed file is asynchronously saved to S3 or the local disk via the StorageAdapter under a unique random key.
* Secure download (GET /api/transformations/history/{itemId}/download): Requires transformations@download (transformations@download_any). Delivers the file to the client as a binary stream with Content-Type and Content-Disposition headers.
* Automatic cleanup (Data Retention Policy): The background retention-worker runs once every 24 hours and automatically deletes saved transformation artifacts whose retention period has exceeded 90 days, erasing the objects from storage and updating the record statuses in the history.

The specification of this Technical Specification fully exhausts the architectural, functional, and non-functional requirements for the backend service and serves as the final, strict guide for the development stage, security audit, and automated testing.
