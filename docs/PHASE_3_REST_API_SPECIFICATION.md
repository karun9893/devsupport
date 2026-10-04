# DevSupport: Developer Issue & Incident Management System
## Phase 3: RESTful API Specification

**Document Version:** 1.0.0  
**Status:** Approved for Implementation (Phase 4)  
**Author:** Principal Backend Architect, API Designer & Security Engineer  
**Authoritative Hierarchy:**
1. `PHASE_1_REQUIREMENTS_SPECIFICATION.md` (Domain & Business Requirements)
2. `PHASE_2_DATABASE_AND_ARCHITECTURE_DESIGN.md` (Database Schemas & Architectural Invariants)
3. `docs/PHASE_2_IMPLEMENTATION_NOTES.md` & `docs/PHASE_2_IMPLEMENTATION_AUDIT.md` (Verified Backend Foundation)

---

## Table of Contents

1. [Architectural Overview & Versioning Strategy](#1-architectural-overview--versioning-strategy)
2. [API Design Principles & REST Architectural Choices](#2-api-design-principles--rest-architectural-choices)
   - 2.1 State Transitions Design Evaluation (`PATCH /issues/:id` vs `POST /issues/:id/transitions`)
   - 2.2 Reassignment & Work Claim Semantics
   - 2.3 Idempotency & Concurrency Strategy
3. [Global Envelopes & Response Contracts](#3-global-envelopes--response-contracts)
   - 3.1 Standard Success Envelope (Single Entity)
   - 3.2 Standard Paginated Collection Envelope
   - 3.3 Canonical Error Envelope
   - 3.4 Master Error Code Catalog
4. [Security & Authentication Protocol](#4-security--authentication-protocol)
   - 4.1 Token Headers & Format
   - 4.2 Dual-Token Rotation & Reuse Detection Contract
   - 4.3 Rate Limiting Headers
5. [Role-Based Access Control (RBAC) Architecture & Authorization Matrix](#5-role-based-access-control-rbac-architecture--authorization-matrix)
   - 5.1 System Roles vs Project Roles
   - 5.2 Authoritative RBAC Decision Flow
   - 5.3 Endpoint Authorization Matrix & Traceability
6. [Complete REST API Endpoint Specifications](#6-complete-rest-api-endpoint-specifications)
   - 6.1 Authentication & Session Management (`/api/v1/auth`)
   - 6.2 User Governance (`/api/v1/users`)
   - 6.3 Project Workspaces & Membership (`/api/v1/projects`)
   - 6.4 Issue Tracking & State Transitions (`/api/v1/projects/:projectId/issues` & `/api/v1/issues/:issueId`)
   - 6.5 Comments & Contextual Dialogue (`/api/v1/issues/:issueId/comments`)
   - 6.6 Activity Feeds & Audit Trail (`/api/v1/projects/:projectId/activity` & `/api/v1/issues/:issueId/activity`)
7. [Pagination, Filtering, Sorting & Search Contract](#7-pagination-filtering-sorting--search-contract)
8. [HTTP Status Code Semantics & Response Mapping](#8-http-status-code-semantics--response-mapping)
9. [Phase 3 Sign-Off & Implementation Hand-off](#9-phase-3-sign-off--implementation-hand-off)

---

## 1. Architectural Overview & Versioning Strategy

### 1.1 URI Prefix & Versioning Strategy
All public endpoints in DevSupport are versioned under the fixed path prefix:
```text
/api/v1
```
- **Rationale for URI Versioning:** Explicit path versioning (`/api/v1/...`) provides deterministic client compatibility, simple cache key segmentation, and frictionless API gateway routing across web, CLI, and integration clients.
- **Breaking Change Policy:** Any backward-incompatible schema evolution (e.g., removing fields, changing enum types, or altering security flows) will increment the major path version to `/api/v2`. Non-breaking additive changes (e.g., adding optional query parameters or new response attributes) remain within `/api/v1`.

### 1.2 Resource URL Hierarchy & Bounded Contexts
DevSupport employs a strict resource hierarchy:
- Top-level resources: `/api/v1/auth`, `/api/v1/users`, `/api/v1/projects`.
- Project-scoped nested collections: `/api/v1/projects/:projectId/issues`, `/api/v1/projects/:projectId/members`.
- Direct entity identification: `/api/v1/issues/:issueId` (also supports Jira-style keys e.g. `CORE-101`), `/api/v1/comments/:commentId`.
- Nested contextual sub-resources: `/api/v1/issues/:issueId/comments`, `/api/v1/issues/:issueId/activity`.

---

## 2. API Design Principles & REST Architectural Choices

### 2.1 State Transitions Design Evaluation
A key architectural design choice in issue and incident trackers is how to model lifecycle state transitions:

#### Option A: Generic Resource Mutation via `PATCH /api/v1/issues/:issueId`
```json
{
  "status": "In_Progress"
}
```
*Drawbacks:* Obscures state-machine side effects. Moving an issue from `Open` to `In_Progress` is not a simple property update—it requires transition invariant validation (T1–T8), auto-claiming unassigned tickets, verifying assignee eligibility, enforcing mandatory reasons (T2/T5), and verifying that assignees cannot close their own issues (T4).

#### Option B: Dedicated Command Resource via `POST /api/v1/issues/:issueId/transitions` (Selected Design)
```json
{
  "toStatus": "In_Progress",
  "expectedVersion": 2,
  "reason": "Work commenced on core authentication bug fix"
}
```
*Architectural Rationale:*
1. **Explicit Domain Intent:** In REST architectural design, modeling state transitions as first-class subordinate operations represents an explicit state-machine event rather than an arbitrary field patch.
2. **Deterministic Payload Validation:** Allows clean validation of transition-specific fields (`expectedVersion`, `reason`) without cluttering generic metadata updates (such as updating title or description).
3. **Audit Alignment:** Directly maps HTTP execution to an atomic domain event (`STATUS_CHANGED`), emitting immutable activity entries in the same database transaction.

### 2.2 Reassignment & Work Claim Semantics
Issue assignment updates are modeled via:
```text
PUT /api/v1/issues/:issueId/assignee
```
- **Payload:** `{ "assigneeId": "651f8a7e3b4a2c001f3e9a22", "expectedVersion": 1 }` or `{ "assigneeId": null, "expectedVersion": 1 }` to unassign.
- **Developer Work Claiming ("Take Issue"):** Enrolled Developers submit `assigneeId` equal to their own authenticated user ID on unassigned tickets.
- **Idempotency:** HTTP `PUT` signals that the resulting assignee state is strictly set to the provided identifier.

### 2.3 Idempotency & Optimistic Concurrency Control (OCC)
To prevent lost updates in multi-developer environments:
- Mutating endpoints (`PUT /api/v1/issues/:issueId/assignee`, `POST /api/v1/issues/:issueId/transitions`, `PATCH /api/v1/issues/:issueId/priority`) accept an integer field:
  ```json
  "expectedVersion": 3
  ```
- If the current document version in MongoDB does not match `expectedVersion`, the API rejects the request with HTTP `409 Conflict` (`VERSION_CONFLICT`).

---

## 3. Global Envelopes & Response Contracts

Every API response emitted by DevSupport conforms to one of three standardized JSON envelopes.

### 3.1 Standard Success Envelope (Single Entity)
Used for `GET`, `POST`, `PUT`, `PATCH` operations returning a single object:
```json
{
  "success": true,
  "data": {
    "id": "651f8a7e3b4a2c001f3e9a11",
    "name": "Sarah Team Lead",
    "email": "lead@devsupport.local",
    "role": "Team Lead",
    "status": "Active",
    "createdAt": "2026-10-04T12:00:00.000Z",
    "updatedAt": "2026-10-04T12:00:00.000Z"
  }
}
```

### 3.2 Standard Paginated Collection Envelope
Used for all collection endpoints (`GET /api/v1/projects`, `GET /api/v1/projects/:projectId/issues`, etc.):
```json
{
  "success": true,
  "data": [
    {
      "id": "651f8a7e3b4a2c001f3e9a44",
      "key": "CORE-1",
      "issueNumber": 1,
      "title": "Crash on registration form",
      "type": "Bug",
      "priority": "High",
      "status": "In_Progress",
      "version": 1,
      "reporterId": "651f8a7e3b4a2c001f3e9a11",
      "assigneeId": "651f8a7e3b4a2c001f3e9a22",
      "createdAt": "2026-10-04T12:30:00.000Z",
      "updatedAt": "2026-10-04T12:45:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "limit": 20,
    "totalRecords": 87,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### 3.3 Canonical Error Envelope
Conforms strictly to Phase 1 §12 / Phase 2:
```json
{
  "success": false,
  "error": {
    "code": "MEMBER_HAS_ACTIVE_ISSUES",
    "message": "Cannot remove member with active assigned issues. Choose 'transfer' or 'unassign' strategy.",
    "details": {
      "activeCount": 2,
      "blockingIssues": [
        {
          "id": "651f8a7e3b4a2c001f3e9a44",
          "key": "CORE-1",
          "title": "Crash on registration form",
          "status": "In_Progress"
        }
      ]
    },
    "timestamp": "2026-10-04T13:00:00.000Z"
  }
}
```

### 3.4 Master Error Code Catalog

| HTTP Status | Error Code | Triggering Scenario | Details Payload Structure |
|:---|:---|:---|:---|
| **400 Bad Request** | `INVALID_IDENTIFIER` | Malformed ObjectId string (not 24 hex chars) | `[]` |
| **400 Bad Request** | `MEMBER_HAS_ACTIVE_ISSUES` | Attempted member removal without offboarding strategy when active tickets exist | `{ activeCount: number, blockingIssues: [{ id, key, title, status }] }` |
| **400 Bad Request** | `RATE_LIMIT_EXCEEDED` | Exceeded 5 failed login/register attempts in 15 minutes | `[]` |
| **401 Unauthorized** | `MISSING_ACCESS_TOKEN` | Request to protected route lacks Bearer Authorization header | `[]` |
| **401 Unauthorized** | `INVALID_ACCESS_TOKEN` | Bearer token signature invalid or tampered | `[]` |
| **401 Unauthorized** | `ACCESS_TOKEN_EXPIRED` | Bearer JWT past its 15-minute lifespan | `[]` |
| **401 Unauthorized** | `INVALID_CREDENTIALS` | Login password mismatch or email does not exist (enumeration safe) | `[]` |
| **401 Unauthorized** | `INVALID_REFRESH_TOKEN` | Refresh token expired, unknown, or format invalid | `[]` |
| **401 Unauthorized** | `REFRESH_TOKEN_REUSE_DETECTED` | Revoked refresh token submitted; session family invalidated | `[]` |
| **403 Forbidden** | `FORBIDDEN` | Caller's system role lacks permission | `[]` |
| **403 Forbidden** | `INSUFFICIENT_PROJECT_ROLE` | Action requires project Lead role, caller is Developer | `[]` |
| **403 Forbidden** | `ACCOUNT_SUSPENDED` | Account status is `Suspended` | `[]` |
| **403 Forbidden** | `ASSIGNMENT_FORBIDDEN` | Developer attempted to assign ticket to another user | `[]` |
| **403 Forbidden** | `SELF_CLOSE_FORBIDDEN` | Assignee attempted to close their own issue (violates T4 QA gate) | `[]` |
| **403 Forbidden** | `TRANSITION_FORBIDDEN` | Caller lacks role capability for specific state transition | `[]` |
| **403 Forbidden** | `PRIORITY_CHANGE_FORBIDDEN` | Developer attempted to change priority on an unowned ticket | `[]` |
| **403 Forbidden** | `APPEND_ONLY_VIOLATION` | Programmatic attempt to update or delete Activity logs | `[]` |
| **404 Not Found** | `RESOURCE_NOT_FOUND` | Generic resource not found | `[]` |
| **404 Not Found** | `PROJECT_NOT_FOUND` | Project does not exist OR caller is not an enrolled member (probed defense) | `[]` |
| **404 Not Found** | `ISSUE_NOT_FOUND` | Issue does not exist OR parent project is non-member to caller | `[]` |
| **404 Not Found** | `MEMBER_NOT_FOUND` | User is not enrolled in the specified project roster | `[]` |
| **404 Not Found** | `USER_NOT_FOUND` | User account does not exist | `[]` |
| **409 Conflict** | `EMAIL_ALREADY_EXISTS` | Registration email already registered | `[]` |
| **409 Conflict** | `PROJECT_KEY_EXISTS` | Project key already taken | `[]` |
| **409 Conflict** | `PROJECT_NAME_EXISTS` | Project name already taken | `[]` |
| **409 Conflict** | `MEMBER_ALREADY_EXISTS` | User already enrolled in project roster | `[]` |
| **409 Conflict** | `PROJECT_ARCHIVED` | Mutation attempted on archived/read-only project | `[]` |
| **409 Conflict** | `VERSION_CONFLICT` | Stale optimistic concurrency version submitted | `{ issueId: string, key: string }` |
| **422 Unprocessable** | `VALIDATION_ERROR` | Schema validation error (e.g. invalid password policy, minlength) | `[{ field: string, message: string }]` |
| **422 Unprocessable** | `INVALID_STATUS_TRANSITION`| Transition not permitted by state machine | `{ from: string, allowed: string[] }` |
| **422 Unprocessable** | `REASON_REQUIRED` | Reason required for T2 (In_Progress -> Open) or T5 (Open -> Closed) | `[]` |
| **422 Unprocessable** | `ASSIGNEE_REQUIRED` | In_Progress issue cannot be left unassigned | `[]` |
| **422 Unprocessable** | `INVALID_ASSIGNEE` | Assignee is not an active, enrolled member of the project | `[]` |
| **422 Unprocessable** | `INVALID_TRANSFER_TARGET` | Member offboarding transfer target is not an active member | `[]` |
| **422 Unprocessable** | `CANNOT_REMOVE_PROJECT_OWNER`| Project owner cannot be removed before transferring ownership | `[]` |
| **500 Internal Error** | `INTERNAL_SERVER_ERROR` | Unhandled server error | `[]` |

---

## 4. Security & Authentication Protocol

### 4.1 Token Headers & Format
Protected endpoints require an `Authorization` HTTP header with a Bearer token:
```http
Authorization: Bearer <access_token>
```
- **Access Token:** Stateless JWT, signed via HMAC-SHA256 (`HS256`). Lifespan: **15 minutes**.
- **Payload Claims:**
  ```json
  {
    "sub": "651f8a7e3b4a2c001f3e9a11",
    "role": "Team Lead",
    "iss": "DevSupport-API",
    "iat": 1728000000,
    "exp": 1728000900
  }
  ```

### 4.2 Dual-Token Rotation & Reuse Detection Contract
- Refresh requests transmit the opaque 64-byte token via JSON body to `POST /api/v1/auth/refresh`.
- **Rotation Behavior:** Each refresh call invalidates the submitted token and returns a new Access Token + new Refresh Token under the same `familyId`.
- **Replay Detection:** If a previously revoked refresh token is submitted, the server invalidates all active tokens in that `familyId` and returns `401 REFRESH_TOKEN_REUSE_DETECTED`.

### 4.3 Rate Limiting Headers
Auth endpoints (`/api/v1/auth/login`, `/api/v1/auth/register`) include standard rate limiting headers:
```http
RateLimit-Limit: 5
RateLimit-Remaining: 4
RateLimit-Reset: 900
```

---

## 5. Role-Based Access Control (RBAC) Architecture & Authorization Matrix

DevSupport enforces a strict, two-tiered authorization architecture directly anchored in Phase 1 §2 and Phase 2 §3.

### 5.1 System Roles vs Project Roles

The authorization model separates global system governance from project-scoped membership roles:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        SYSTEM ROLES (User.role)                        │
│                                                                        │
│   • Admin: Global system administration across all workspaces          │
│   • Team Lead: Project management capability; project-scoped           │
│   • Developer: Software contributor capability; project-scoped         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  Enrolled into Project Membership Roster
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PROJECT MEMBERSHIP ROLES (members.projectRole)         │
│                                                                        │
│   • Lead: Project-level administrative & lead authority                │
│   • Developer: Project-level engineering contributor                   │
└────────────────────────────────────────────────────────────────────────┘
```

#### Authoritative Role Invariants
1. **System Roles (`User.role`):** Exactly `['Admin', 'Team Lead', 'Developer']`.
   - `Admin`: Global system governance, user account management, project creation, administrative overrides, global audit visibility.
   - `Team Lead`: Project management, member roster maintenance, issue assignment/triage, state transition authority, comment moderation.
   - `Developer`: Standard project contributor, issue creation, work claiming (self-assignment), developer-permitted state transitions, personal comment authoring.
2. **Project Membership Roles (`ProjectMember.projectRole`):** Exactly `['Lead', 'Developer']`.
   - Only users with system role `Admin` or `Team Lead` can hold `Lead` in a project membership roster.
   - Users with system role `Developer` hold project role `Developer`.
3. **No Phantom Roles:** Roles such as `User`, `ProjectManager`, `TechLead`, `Reporter`, or `Viewer` do NOT exist as authorization roles. Descriptive terms such as "reporter" refer strictly to the user who filed a ticket (`reporterId`), and "author" refers strictly to comment creator (`authorId`).

---

### 5.2 Authoritative RBAC Decision Flow

Every protected HTTP request evaluated by the API gateway and controllers undergoes the following deterministic evaluation cascade:

```text
Incoming HTTP Request
        │
        ▼
[1. Authentication Gate] ─── Missing/Invalid JWT? ───► 401 Unauthorized
        │
        ▼
[2. Account Status Gate] ─── status === 'Suspended'? ─► 403 ACCOUNT_SUSPENDED
        │
        ▼
[3. System Role Evaluation (User.role)]
        │
        ├─► Admin: Full global system privileges (User mgmt, cross-project access)
        │
        ▼
[4. Project Membership Gate]
        │
        ├─► User NOT in Project.members? ─────────────► 404 PROJECT_NOT_FOUND
        │                                              (Probing defense per Phase 1 §2.3)
        ▼
[5. Project Role Evaluation (members.projectRole)]
        │
        ├─► Lead: Full project management, issue assignment, roster updates, QA closing
        ├─► Developer: Scoped engineering actions (claim work, comment, create issues)
        │
        ▼
[6. Resource Ownership & Business Invariants]
        │
        ├─► Self-Close Violation (Assignee cannot close own issue)? ──► 403 SELF_CLOSE_FORBIDDEN
        ├─► Assignee Reassignment Forbidden for Developer? ─────────► 403 ASSIGNMENT_FORBIDDEN
        ├─► Unowned Priority Modification Forbidden? ───────────────► 403 PRIORITY_CHANGE_FORBIDDEN
        └─► Invalid State Transition Invariant? ────────────────────► 422 INVALID_STATUS_TRANSITION
```

---

### 5.3 Endpoint Authorization Matrix & Traceability

The following matrix maps every API resource to the authoritative Phase 1 RBAC requirements and Phase 2 database models:

| Endpoint | HTTP Method | Admin | Team Lead (Project Lead) | Team Lead (Non-Member) | Developer (Project Member) | Developer (Non-Member) | Traceability / Business Rule |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---|
| `/api/v1/auth/register` | `POST` | Public | Public | Public | Public | Public | Self-registration; provisions system role `Developer` |
| `/api/v1/auth/login` | `POST` | Public | Public | Public | Public | Public | Dual-token authentication |
| `/api/v1/auth/refresh` | `POST` | Public | Public | Public | Public | Public | Token family rotation & replay detection |
| `/api/v1/auth/logout` | `POST` | Member | Member | Member | Member | Member | Revokes token family |
| `/api/v1/auth/me` | `GET` | Authenticated | Authenticated | Authenticated | Authenticated | Authenticated | Retrieves current caller profile |
| `/api/v1/users` | `GET` | All | Active Only | Active Only | Active Only | Active Only | User assignment directory |
| `/api/v1/users/:userId/status` | `PATCH` | Allowed | Denied (403) | Denied (403) | Denied (403) | Denied (403) | Admin-only account lifecycle governance |
| `/api/v1/projects` | `POST` | Allowed | Allowed | Allowed | Denied (403) | Denied (403) | Project creation; creator assigned `Lead` |
| `/api/v1/projects` | `GET` | All Projects | Enrolled | Enrolled | Enrolled | Enrolled | List accessible project workspaces |
| `/api/v1/projects/:projectId` | `GET` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Project details and member roster |
| `/api/v1/projects/:projectId/archive` | `POST` | Allowed | Allowed | Denied (404) | Denied (403) | Denied (404) | Archive workspace into read-only mode |
| `/api/v1/projects/:projectId/members` | `POST` | Allowed | Allowed | Denied (404) | Denied (403) | Denied (404) | Add active user with role `Lead` or `Developer` |
| `/api/v1/projects/:projectId/members/:userId` | `DELETE` | Allowed | Allowed | Denied (404) | Denied (403) | Denied (404) | Offboard member with active issue guards |
| `/api/v1/projects/:projectId/issues` | `POST` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Create issue (Developer assignee = self or null) |
| `/api/v1/projects/:projectId/issues` | `GET` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Filter, sort, paginate, and search issues |
| `/api/v1/issues/:issueId` | `GET` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Fetch single issue by ObjectId or key |
| `/api/v1/issues/:issueId/transitions` | `POST` | Allowed | Full Lifecycle | Denied (404) | Allowed (T1, T2, T3, T7) | Denied (404) | State machine execution; T4 QA gate enforced |
| `/api/v1/issues/:issueId/assignee` | `PUT` | Any Member | Any Member | Denied (404) | Self-claim or unclaim | Denied (404) | Work allocation & developer self-claiming |
| `/api/v1/issues/:issueId/priority` | `PATCH` | Allowed | Allowed | Denied (404) | Creator / Assignee | Denied (404) | Issue priority modification |
| `/api/v1/issues/:issueId/comments` | `POST` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Create discussion comment |
| `/api/v1/issues/:issueId/comments` | `GET` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Read conversation history |
| `/api/v1/comments/:commentId` | `PATCH` | Author Only | Author Only | Denied (404) | Author Only | Denied (404) | Edit comment content |
| `/api/v1/comments/:commentId` | `DELETE` | Allowed (Mod) | Allowed (Mod) | Denied (404) | Author Only | Denied (404) | Delete comment or lead moderation |
| `/api/v1/issues/:issueId/activity` | `GET` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Issue audit timeline |
| `/api/v1/projects/:projectId/activity` | `GET` | Allowed | Allowed | Denied (404) | Allowed | Denied (404) | Project-wide audit trail |

---

## 6. Complete REST API Endpoint Specifications

---

### 6.1 Authentication & Session Management (`/api/v1/auth`)

#### 6.1.1 `POST /api/v1/auth/register`
Creates a new developer account. Open registration provisions users strictly with role `Developer`.
- **Authentication:** Public
- **Rate Limit:** 5 requests / 15 minutes
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "name": "Alex Developer",
    "email": "alex@devsupport.local",
    "password": "Password123!"
  }
  ```
- **Validation Rules:**
  - `name`: String, 2–60 chars, trimmed.
  - `email`: Valid RFC 5322 email string. Automatically normalized to lowercase.
  - `password`: String, 8–64 chars, containing $\ge 1$ uppercase, $\ge 1$ lowercase, $\ge 1$ digit, and $\ge 1$ special symbol (`!@#$%^&*`).
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "651f8a7e3b4a2c001f3e9a33",
      "name": "Alex Developer",
      "email": "alex@devsupport.local",
      "role": "Developer",
      "status": "Active",
      "createdAt": "2026-10-04T12:00:00.000Z",
      "updatedAt": "2026-10-04T12:00:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `409 Conflict`: `EMAIL_ALREADY_EXISTS` ("An account with this email address already exists.")
  - `422 Unprocessable Entity`: `VALIDATION_ERROR` (Password does not meet complexity rules or email invalid)

---

#### 6.1.2 `POST /api/v1/auth/login`
Authenticates user credentials and issues a fresh Access Token and Refresh Token pair.
- **Authentication:** Public
- **Rate Limit:** 5 requests / 15 minutes
- **Request Body:**
  ```json
  {
    "email": "alex@devsupport.local",
    "password": "Password123!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "tokenType": "Bearer",
      "accessTokenExpiresIn": 900,
      "refreshToken": "4a7f9c2e01b4d8a7c2b5e9f1a3d6c8b0e7f4a2d1c9b6e8f3a5d7c2b9e1f4a6d8...",
      "refreshTokenExpiresAt": "2026-10-11T12:00:00.000Z",
      "user": {
        "id": "651f8a7e3b4a2c001f3e9a33",
        "name": "Alex Developer",
        "email": "alex@devsupport.local",
        "role": "Developer",
        "status": "Active",
        "lastLoginAt": "2026-10-04T12:05:00.000Z"
      }
    }
  }
  ```
- **Error Responses:**
  - `401 Unauthorized`: `INVALID_CREDENTIALS` ("Invalid email or password.")
  - `403 Forbidden`: `ACCOUNT_SUSPENDED` ("Your account has been deactivated. Contact your system administrator.")

---

#### 6.1.3 `POST /api/v1/auth/refresh`
Rotates an unexpired refresh token, invalidating the old token and issuing a new Access Token and Refresh Token.
- **Authentication:** Public (Refresh Token acts as credential)
- **Request Body:**
  ```json
  {
    "refreshToken": "4a7f9c2e01b4d8a7c2b5e9f1a3d6c8b0e7f4a2d1c9b6e8f3a5d7c2b9e1f4a6d8..."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new...",
      "tokenType": "Bearer",
      "accessTokenExpiresIn": 900,
      "refreshToken": "7c8e9f1a2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f...",
      "refreshTokenExpiresAt": "2026-10-11T12:15:00.000Z",
      "user": {
        "id": "651f8a7e3b4a2c001f3e9a33",
        "name": "Alex Developer",
        "email": "alex@devsupport.local",
        "role": "Developer",
        "status": "Active"
      }
    }
  }
  ```
- **Error Responses:**
  - `401 Unauthorized`: `INVALID_REFRESH_TOKEN` ("Invalid or expired refresh token.")
  - `401 Unauthorized`: `REFRESH_TOKEN_REUSE_DETECTED` ("Token reuse detected. All sessions for this login have been terminated.")
  - `403 Forbidden`: `ACCOUNT_SUSPENDED` ("Your account has been deactivated.")

---

#### 6.1.4 `POST /api/v1/auth/logout`
Revokes the session family associated with the supplied refresh token.
- **Authentication:** Optional / Bearer
- **Request Body:**
  ```json
  {
    "refreshToken": "4a7f9c2e01b4d8a7c2b5e9f1a3d6c8b0e7f4a2d1c9b6e8f3a5d7c2b9e1f4a6d8..."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Logged out successfully. Session tokens revoked."
    }
  }
  ```

---

#### 6.1.5 `GET /api/v1/auth/me`
Retrieves the profile of the currently authenticated caller.
- **Authentication:** Required (`Bearer <access_token>`)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "651f8a7e3b4a2c001f3e9a33",
      "name": "Alex Developer",
      "email": "alex@devsupport.local",
      "role": "Developer",
      "status": "Active",
      "createdAt": "2026-10-04T12:00:00.000Z",
      "updatedAt": "2026-10-04T12:00:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `401 Unauthorized`: `INVALID_ACCESS_TOKEN` / `ACCESS_TOKEN_EXPIRED`

---

### 6.2 User Governance (`/api/v1/users`)

#### 6.2.1 `GET /api/v1/users`
Lists active registered users for project assignment directories.
- **Authentication:** Required (`Bearer`)
- **Query Parameters:**
  - `search`: Substring search on `name` or `email`.
  - `role`: Filter by system role (`Admin`, `Team Lead`, `Developer`).
  - `page`: Integer $\ge 1$ (default 1).
  - `limit`: Integer 1–100 (default 20).
- **Access Control:** All authenticated roles can list Active users; `Admin` can also list Suspended users.
- **Response (200 OK):** Standard paginated collection envelope.

---

#### 6.2.2 `PATCH /api/v1/users/:userId/status`
Suspends or activates a user account.
- **Authentication:** Required (`Bearer`)
- **Access Control:** `Admin` only.
- **Request Body:**
  ```json
  {
    "status": "Suspended"
  }
  ```
- **Response (200 OK):** Returns updated user profile. All active refresh tokens for the suspended user are revoked.
- **Error Responses:**
  - `403 Forbidden`: `FORBIDDEN` ("Only an Admin can change account status.")
  - `404 Not Found`: `USER_NOT_FOUND`

---

### 6.3 Project Workspaces & Membership (`/api/v1/projects`)

#### 6.3.1 `POST /api/v1/projects`
Provisions a new project workspace.
- **Authentication:** Required (`Bearer`)
- **Access Control:** `Admin`, or `Team Lead`.
- **Request Body:**
  ```json
  {
    "name": "Payment Gateway Engine",
    "key": "PAY",
    "description": "Core transaction processing microservices and ledger integrations."
  }
  ```
- **Validation Rules:**
  - `name`: String, 3–80 characters, trimmed. Must be globally unique.
  - `key`: String, 2–10 uppercase alphanumeric characters (`^[A-Z][A-Z0-9]{1,9}$`), immutable.
  - `description`: String, up to 1000 characters.
- **Side Effects:**
  - Project creator is added to `members` as `Lead`.
  - Sequence counter initialized at `0`.
  - `PROJECT_CREATED` activity log record emitted.
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "651f8a7e3b4a2c001f3e9a55",
      "name": "Payment Gateway Engine",
      "key": "PAY",
      "description": "Core transaction processing microservices and ledger integrations.",
      "ownerId": "651f8a7e3b4a2c001f3e9a11",
      "status": "Active",
      "members": [
        {
          "userId": "651f8a7e3b4a2c001f3e9a11",
          "projectRole": "Lead",
          "joinedAt": "2026-10-04T12:00:00.000Z"
        }
      ],
      "createdAt": "2026-10-04T12:00:00.000Z",
      "updatedAt": "2026-10-04T12:00:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `403 Forbidden`: `FORBIDDEN` ("Only Admins and Team Leads can create projects.")
  - `409 Conflict`: `PROJECT_KEY_EXISTS` ("A project with this key already exists.")
  - `409 Conflict`: `PROJECT_NAME_EXISTS` ("A project with this name already exists.")

---

#### 6.3.2 `GET /api/v1/projects`
Retrieves projects accessible to the caller.
- **Authentication:** Required (`Bearer`)
- **Access Control:**
  - `Admin`: Returns all projects in the system.
  - `Team Lead` / `Developer`: Returns **only** projects in which the caller is an enrolled member.
- **Query Parameters:** `status` (`Active` | `Archived`), `page`, `limit`.
- **Response (200 OK):** Standard paginated collection envelope.

---

#### 6.3.3 `GET /api/v1/projects/:projectId`
Fetches detailed metadata and member roster of a project.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Admin, or enrolled member of `:projectId`. Non-members receive `404 PROJECT_NOT_FOUND`.
- **Response (200 OK):** Standard single entity envelope.

---

#### 6.3.4 `POST /api/v1/projects/:projectId/archive`
Archives an active project, placing it into permanent read-only mode.
- **Authentication:** Required (`Bearer`)
- **Access Control:** `Admin`, or enrolled project `Lead`.
- **Request Body:**
  ```json
  {
    "reason": "Project completed and deprecated in favor of PAY-V2."
  }
  ```
- **Response (200 OK):** Updated project with `status: "Archived"`. Emits `PROJECT_ARCHIVED` audit record.
- **Error Responses:**
  - `403 Forbidden`: `INSUFFICIENT_PROJECT_ROLE`
  - `409 Conflict`: `PROJECT_ARCHIVED` ("This project is already archived.")

---

#### 6.3.5 `POST /api/v1/projects/:projectId/members`
Enrolls an active user into the project roster.
- **Authentication:** Required (`Bearer`)
- **Access Control:** `Admin`, or enrolled project `Lead`.
- **Request Body:**
  ```json
  {
    "userId": "651f8a7e3b4a2c001f3e9a33",
    "projectRole": "Developer"
  }
  ```
- **Validation Rules:**
  - `userId`: Valid ObjectId of an existing, Active user.
  - `projectRole`: Enum (`Lead` | `Developer`). Only users with system role `Admin` or `Team Lead` can be granted `Lead`.
- **Response (200 OK):** Updated project document. Emits `PROJECT_MEMBER_ADDED` audit record.
- **Error Responses:**
  - `409 Conflict`: `MEMBER_ALREADY_EXISTS` ("User is already a member of this project.")
  - `422 Unprocessable Entity`: `INVALID_MEMBER` ("Only existing, active users can be added to a project.")
  - `422 Unprocessable Entity`: `INVALID_PROJECT_ROLE` ("Only Team Leads or Admins can hold the project Lead role.")

---

#### 6.3.6 `DELETE /api/v1/projects/:projectId/members/:userId`
Removes a member from the project roster.
- **Authentication:** Required (`Bearer`)
- **Access Control:** `Admin`, or enrolled project `Lead`.
- **Request Body (Optional Resolution Directives):**
  ```json
  {
    "strategy": "transfer",
    "transferToUserId": "651f8a7e3b4a2c001f3e9a22"
  }
  ```
  *or*
  ```json
  {
    "strategy": "unassign"
  }
  ```
- **Business Rules & Guards:**
  1. Target user cannot be the project owner (`CANNOT_REMOVE_PROJECT_OWNER`).
  2. If the user has active assigned issues (`Open`, `In_Progress`, `Reopened`) and **no strategy** is provided, the request is BLOCKED with `400 Bad Request`.
  3. If `strategy: "unassign"` is specified, all active tickets have `assigneeId` set to `null` (and `In_Progress` tickets revert to `Open`).
  4. If `strategy: "transfer"` is specified, all active tickets are atomically reassigned to `transferToUserId`.
  5. All issue mutations, individual `ASSIGNEE_CHANGED` audit records, and member removal commit in one transaction.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "removedUserId": "651f8a7e3b4a2c001f3e9a33",
      "strategy": "transfer",
      "affectedIssues": [
        {
          "id": "651f8a7e3b4a2c001f3e9a44",
          "key": "PAY-12",
          "status": "In_Progress",
          "assigneeId": "651f8a7e3b4a2c001f3e9a22"
        }
      ]
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: `MEMBER_HAS_ACTIVE_ISSUES` (Returns blocking issue IDs)
  - `404 Not Found`: `MEMBER_NOT_FOUND`
  - `422 Unprocessable Entity`: `CANNOT_REMOVE_PROJECT_OWNER`
  - `422 Unprocessable Entity`: `INVALID_TRANSFER_TARGET`

---

### 6.4 Issue Tracking & State Transitions

#### 6.4.1 `POST /api/v1/projects/:projectId/issues`
Creates a new issue or incident under the designated project.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Enrolled member of `:projectId` (`Developer`, `Lead`) or `Admin`.
- **Request Body:**
  ```json
  {
    "title": "Database connection pool exhaustion under peak load",
    "description": "Steps to reproduce: execute k6 load test with 500 VUs. Database connection pool reaches max 100 connections and starts dropping requests.",
    "type": "Incident",
    "priority": "Critical",
    "assigneeId": "651f8a7e3b4a2c001f3e9a11"
  }
  ```
- **Validation Rules:**
  - `title`: String, 5–150 characters, trimmed.
  - `description`: String, 10–5000 characters, trimmed.
  - `type`: Enum (`Bug`, `Feature`, `Task`, `Incident`). Required.
  - `priority`: Enum (`Low`, `Medium`, `High`, `Critical`). Defaults to `Medium`.
  - `assigneeId`: Optional ObjectId. If supplied by a Developer, must match caller ID. Target must be an enrolled project member.
- **Key Allocation:** Atomically increments `Counter` sequence. Formats key as `PROJECT_KEY-<seq>` (e.g. `PAY-101`).
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "651f8a7e3b4a2c001f3e9a77",
      "key": "PAY-101",
      "issueNumber": 101,
      "projectId": "651f8a7e3b4a2c001f3e9a55",
      "title": "Database connection pool exhaustion under peak load",
      "description": "Steps to reproduce: execute k6 load test with 500 VUs...",
      "type": "Incident",
      "priority": "Critical",
      "status": "Open",
      "reporterId": "651f8a7e3b4a2c001f3e9a11",
      "assigneeId": "651f8a7e3b4a2c001f3e9a11",
      "version": 0,
      "createdAt": "2026-10-04T12:30:00.000Z",
      "updatedAt": "2026-10-04T12:30:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `403 Forbidden`: `ASSIGNMENT_FORBIDDEN` ("Developers can only assign issues to themselves.")
  - `404 Not Found`: `PROJECT_NOT_FOUND`
  - `422 Unprocessable Entity`: `INVALID_ASSIGNEE` ("Assignee must be an active enrolled member of this project.")

---

#### 6.4.2 `GET /api/v1/projects/:projectId/issues`
Lists, filters, and searches issues within a project.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Enrolled project member or `Admin`.
- **Query Parameters:**
  - `status`: Comma-separated enums (e.g. `?status=Open,In_Progress`).
  - `priority`: Comma-separated enums (e.g. `?priority=High,Critical`).
  - `type`: Comma-separated enums (e.g. `?type=Bug,Incident`).
  - `assigneeId`: ObjectId or literal `unassigned`.
  - `reporterId`: ObjectId.
  - `q`: Text search query string (matches key, title, description).
  - `sortBy`: Field name (`createdAt`, `updatedAt`, `priority`, `status`, `title`). Default `createdAt`.
  - `order`: `asc` or `desc`. Default `desc`.
  - `page`: Integer $\ge 1$. Default `1`.
  - `limit`: Integer 1–100. Default `20`.
- **Response (200 OK):** Standard paginated collection envelope.

---

#### 6.4.3 `GET /api/v1/issues/:issueId`
Retrieves a single issue by its MongoDB ObjectId **or** Jira-style key (e.g., `/api/v1/issues/PAY-101`).
- **Authentication:** Required (`Bearer`)
- **Access Control:** Enrolled member of parent project or `Admin`.
- **Response (200 OK):** Standard single entity envelope.

---

#### 6.4.4 `POST /api/v1/issues/:issueId/transitions`
Executes a lifecycle state transition governed by the deterministic state machine (T1–T8).
- **Authentication:** Required (`Bearer`)
- **Request Body:**
  ```json
  {
    "toStatus": "In_Progress",
    "expectedVersion": 0,
    "reason": "Starting development work on sprint ticket"
  }
  ```
- **Validation Rules & Invariants:**
  - `toStatus`: Valid target per state machine (e.g. `Open` $\to$ `In_Progress`).
  - `expectedVersion`: Non-negative integer matching current issue `version`.
  - `reason`: Mandatory string for T2 (`In_Progress` $\to$ `Open`) and T5 (`Open` $\to$ `Closed`).
  - **QA Verification Gate (T4):** The assignee is strictly prohibited from executing `Resolved` $\to$ `Closed`. Requires `Lead` or `Admin`.
  - **Auto-Claim (T1 / T8):** If ticket is unassigned and moving to `In_Progress`, automatically assigns to the calling developer.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "651f8a7e3b4a2c001f3e9a77",
      "key": "PAY-101",
      "status": "In_Progress",
      "assigneeId": "651f8a7e3b4a2c001f3e9a33",
      "version": 1,
      "updatedAt": "2026-10-04T12:45:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `403 Forbidden`: `SELF_CLOSE_FORBIDDEN` ("The assignee cannot close their own issue; independent verification is required.")
  - `403 Forbidden`: `TRANSITION_FORBIDDEN` ("You are not permitted to move this issue from Open to Resolved.")
  - `409 Conflict`: `VERSION_CONFLICT` ("The issue was modified by another user. Please refresh and retry.")
  - `422 Unprocessable Entity`: `INVALID_STATUS_TRANSITION`
  - `422 Unprocessable Entity`: `REASON_REQUIRED`

---

#### 6.4.5 `PUT /api/v1/issues/:issueId/assignee`
Assigns, reassigns, claims, or unassigns an issue.
- **Authentication:** Required (`Bearer`)
- **Request Body:**
  ```json
  {
    "assigneeId": "651f8a7e3b4a2c001f3e9a33",
    "expectedVersion": 1
  }
  ```
- **Rules:**
  - `Lead` / `Admin`: Can assign to any eligible member or set `null` (unless status is `In_Progress`).
  - `Developer`: Can claim unassigned tickets (`assigneeId` = caller) or release own assignment.
  - Target must be an Active enrolled project member.
- **Response (200 OK):** Updated issue with incremented `version`. Emits `ASSIGNEE_CHANGED` audit record.
- **Error Responses:**
  - `403 Forbidden`: `ASSIGNMENT_FORBIDDEN`
  - `409 Conflict`: `VERSION_CONFLICT`
  - `422 Unprocessable Entity`: `ASSIGNEE_REQUIRED` ("An issue in status In_Progress must keep an assignee. Move it back to Open first.")
  - `422 Unprocessable Entity`: `INVALID_ASSIGNEE`

---

#### 6.4.6 `PATCH /api/v1/issues/:issueId/priority`
Modifies the severity priority of an issue.
- **Authentication:** Required (`Bearer`)
- **Access Control:** `Lead` / `Admin`, or the `Developer` who reported or is assigned to the ticket.
- **Request Body:**
  ```json
  {
    "priority": "Critical",
    "expectedVersion": 1
  }
  ```
- **Response (200 OK):** Updated issue. Emits `PRIORITY_CHANGED` audit record.
- **Error Responses:**
  - `403 Forbidden`: `PRIORITY_CHANGE_FORBIDDEN`
  - `409 Conflict`: `VERSION_CONFLICT`

---

### 6.5 Comments & Contextual Dialogue (`/api/v1/issues/:issueId/comments`)

#### 6.5.1 `POST /api/v1/issues/:issueId/comments`
Posts a new discussion comment on an issue.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Enrolled member of parent project or `Admin`.
- **Request Body:**
  ```json
  {
    "content": "Root cause identified: TCP socket leak in Redis client connection pooling."
  }
  ```
- **Validation Rules:**
  - `content`: String, 1–3000 characters, trimmed.
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "651f8a7e3b4a2c001f3e9a88",
      "issueId": "651f8a7e3b4a2c001f3e9a77",
      "authorId": "651f8a7e3b4a2c001f3e9a33",
      "content": "Root cause identified: TCP socket leak in Redis client connection pooling.",
      "isEdited": false,
      "createdAt": "2026-10-04T12:50:00.000Z",
      "updatedAt": "2026-10-04T12:50:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `404 Not Found`: `ISSUE_NOT_FOUND`
  - `409 Conflict`: `PROJECT_ARCHIVED`

---

#### 6.5.2 `GET /api/v1/issues/:issueId/comments`
Fetches chronological conversation comments for an issue.
- **Authentication:** Required (`Bearer`)
- **Query Parameters:** `page`, `limit`.
- **Response (200 OK):** Standard paginated collection envelope (ordered by `createdAt ASC`).

---

#### 6.5.3 `PATCH /api/v1/comments/:commentId`
Edits comment text.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Original author only.
- **Request Body:** `{ "content": "Updated diagnostic stack trace..." }`
- **Response (200 OK):** Returns updated comment with `isEdited: true`.

---

#### 6.5.4 `DELETE /api/v1/comments/:commentId`
Deletes a comment.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Original author, project `Lead`, or system `Admin` (moderation).
- **Response (200 OK):** `{ "success": true, "data": { "message": "Comment deleted successfully." } }`. Emits `COMMENT_DELETED` audit record.

---

### 6.6 Activity Feeds & Audit Trail

#### 6.6.1 `GET /api/v1/issues/:issueId/activity`
Retrieves reverse-chronological timeline of audit events for a specific issue.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Enrolled member of parent project or `Admin`.
- **Query Parameters:** `page`, `limit`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "651f8a7e3b4a2c001f3e9a99",
        "entityType": "Issue",
        "entityId": "651f8a7e3b4a2c001f3e9a77",
        "projectId": "651f8a7e3b4a2c001f3e9a55",
        "actorId": "651f8a7e3b4a2c001f3e9a33",
        "actionType": "STATUS_CHANGED",
        "details": {
          "oldValue": "Open",
          "newValue": "In_Progress",
          "reason": "Starting work"
        },
        "createdAt": "2026-10-04T12:45:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "limit": 20,
      "totalRecords": 4,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
  ```

---

#### 6.6.2 `GET /api/v1/projects/:projectId/activity`
Retrieves project-wide audit timeline across all issues, membership roster updates, and project setting changes.
- **Authentication:** Required (`Bearer`)
- **Access Control:** Enrolled member of parent project or `Admin`.
- **Query Parameters:** `page`, `limit`.
- **Response (200 OK):** Standard paginated collection envelope.

---

## 7. Pagination, Filtering, Sorting & Search Contract

### 7.1 Pagination Standard
All collection endpoints implement offset-based pagination:
- `page`: Integer $\ge 1$ (default `1`).
- `limit`: Integer $\ge 1$ and $\le 100$ (default `20`). If client requests `limit > 100`, the server clamps it to `100`.

### 7.2 Filtering Combinators
Query parameters on `/api/v1/projects/:projectId/issues`:
- `status`: String with comma-separated values: `?status=Open,In_Progress,Reopened`
- `priority`: String with comma-separated values: `?priority=High,Critical`
- `type`: String with comma-separated values: `?type=Bug,Incident`
- `assigneeId`: Accepts valid 24-character hex ObjectId, or literal `unassigned` (`?assigneeId=unassigned`)
- `reporterId`: Accepts valid 24-character hex ObjectId

### 7.3 Sorting Rules
- `sortBy`: Field name (`createdAt`, `updatedAt`, `priority`, `status`, `title`). Default `createdAt`.
- `order`: `asc` or `desc`. Default `desc`.
- **Priority Urgency Sort:** When `sortBy=priority`, queries sort by integer severity weight rather than alphabetical strings:
  $$\text{Critical (4)} > \text{High (3)} > \text{Medium (2)} > \text{Low (1)}$$

### 7.4 Full-Text Search
- Query parameter `?q=search_term` triggers MongoDB text index execution matching `key`, `title`, and `description`.
- Automatically combined with project-scoping and security filters.

---

## 8. HTTP Status Code Semantics & Response Mapping

| HTTP Code | Description | Standard Usage in DevSupport |
|:---|:---|:---|
| **200 OK** | Success with response body | Standard GET, PUT, PATCH, DELETE operations. |
| **201 Created** | Resource created | Successful registration, project creation, issue submission, comment posting. |
| **400 Bad Request** | Malformed request or guard rejection | Malformed JSON, invalid ObjectId syntax, member offboarding blocked by active issues. |
| **401 Unauthorized** | Authentication failure | Missing, expired, or invalid JWT; invalid credentials; refresh token reuse detected. |
| **403 Forbidden** | Authorization failure | Insufficient system role, non-lead attempting project settings changes, developer closing tickets. |
| **404 Not Found** | Resource does not exist | Unknown entity ID, or non-member attempting to view project/issue (probing defense). |
| **409 Conflict** | State collision or duplicate | Duplicate email, duplicate project key, archived project mutation, OCC version collision. |
| **422 Unprocessable** | Domain semantic violation | Password complexity violation, invalid state machine transition, invalid assignee. |
| **500 Server Error** | Internal system fault | Unhandled database or operational exception. |

---

## 9. Phase 3 Sign-Off & Implementation Hand-off

This specification serves as the formal API contract for Phase 4 (REST API Implementation). Backend engineers can implement routes, validators, controllers, and tests directly against these schemas without ambiguity.

**Hand-off Checklist:**
- [x] Every domain requirement from Phase 1 has a mapped endpoint.
- [x] Every schema, index, and transaction constraint from Phase 2 is satisfied.
- [x] Standard success, pagination, and error envelopes are uniformly enforced.
- [x] Optimistic Concurrency Control (`expectedVersion`) and offboarding directives are explicitly documented.
