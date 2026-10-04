# DevSupport — Phase 2 Implementation Notes

## Architecture & Database Foundation

This document details the practical implementation decisions and architecture implemented for **Phase 2: Database & Architecture Implementation**.

---

## 1. Directory Structure

```text
devsupport/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── constants.js          # Domain enums, regexes, format rules
│   │   │   ├── database.js           # MongoDB connection & replica set validation
│   │   │   └── env.js                # Environment configuration loader with fail-fast validation
│   │   ├── middleware/
│   │   │   ├── auth.js               # JWT authentication & role authorization
│   │   │   └── errorHandler.js       # Centralized error handler returning Phase 1 §12 envelope
│   │   ├── models/
│   │   │   ├── plugins/
│   │   │   │   └── toJSON.js         # Strips __v, passwordHash, and maps _id -> id
│   │   │   ├── Activity.js           # Append-only audit log model
│   │   │   ├── Comment.js            # Issue discussion comments model
│   │   │   ├── Counter.js            # Atomic issue sequence counter model
│   │   │   ├── Issue.js              # Issue model with Jira-style key & OCC
│   │   │   ├── Project.js            # Project model with roster invariants
│   │   │   ├── RefreshToken.js       # Hashed refresh token store with TTL index
│   │   │   ├── User.js               # User model with case-insensitive unique email
│   │   │   └── index.js              # Models registry
│   │   ├── repositories/             # Pure data-access layer
│   │   │   ├── activityRepository.js
│   │   │   ├── issueRepository.js
│   │   │   ├── projectRepository.js
│   │   │   ├── refreshTokenRepository.js
│   │   │   └── userRepository.js
│   │   ├── services/                 # Domain logic & transaction orchestration
│   │   │   ├── accessControl.js      # Project-scoped RBAC primitives
│   │   │   ├── activityService.js    # Audit log event builders
│   │   │   ├── assignmentRules.js    # Eligible assignee validation
│   │   │   ├── authService.js        # Registration & login with enumeration protection
│   │   │   ├── issueService.js       # Atomic numbering, state machine transitions, OCC
│   │   │   ├── projectService.js     # Project governance & atomic offboarding engine
│   │   │   ├── tokenService.js       # Dual-token issuance, rotation & reuse detection
│   │   │   └── userService.js        # User management & account deactivation
│   │   ├── utils/
│   │   │   ├── AppError.js           # Operational error with standard error codes
│   │   │   ├── asyncHandler.js      # Express 4 async route wrapper
│   │   │   ├── crypto.js             # Crypto random tokens & SHA-256 digests
│   │   │   ├── issueStateMachine.js  # Declarative T1-T8 transition rules
│   │   │   ├── logger.js             # Structured logger with URI credential redaction
│   │   │   ├── objectId.js           # ObjectId validation & null-safe comparison
│   │   │   └── transaction.js        # ACID multi-document transaction helper
│   │   ├── validators/
│   │   │   └── commonValidators.js   # Input validation rules
│   │   ├── app.js                    # Express app configuration & middleware
│   │   └── server.js                 # HTTP server bootstrap & graceful shutdown
│   ├── scripts/
│   │   ├── dev-replset.js            # Local replica set instructions
│   │   ├── seed.js                   # Database seeding with standard users & sample project
│   │   └── sync-indexes.js           # Master index synchronization script
│   ├── tests/
│   │   ├── setup.js                  # MongoMemoryReplSet test harness
│   │   ├── models.test.js            # Schema invariants & append-only validation
│   │   ├── issueCounter.test.js      # Atomic sequence & concurrent Jira key generation
│   │   ├── offboarding.test.js       # Member offboarding blocking & atomic unassignment
│   │   └── authTokens.test.js        # Dual-token rotation & token reuse detection
│   ├── .env
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
└── docs/
    ├── PHASE_1_REQUIREMENTS_SPECIFICATION.md
    └── PHASE_2_DATABASE_AND_ARCHITECTURE_DESIGN.md
```

---

## 2. Key Architectural Highlights Implemented

### 2.1 Jira-Style Human-Readable Issue Keys
- Handled atomically via `Counter.nextSequence(projectId)` using MongoDB's `$inc` on `issue_seq_<projectId>`.
- Generates keys formatted as `PROJECT_KEY-<sequential number>` (e.g. `DEV-1`, `DEV-2`).
- Guaranteed unique at the database level via a compound index on `{ projectId: 1, issueNumber: 1 }`.

### 2.2 Member Offboarding Protocol
- Default behavior: blocks removal with `400 Bad Request` (`MEMBER_HAS_ACTIVE_ISSUES`) returning an array of blocking tickets.
- Resolution directives:
  - `unassign`: Atomically unassigns all active issues and transitions `In_Progress` issues back to `Open`.
  - `transfer`: Atomically reassigns all active issues to `transferToUserId` (validating that the target user is an enrolled member).
- Commits issue reassignments, activity logs, and roster modifications inside a single multi-document ACID transaction.

### 2.3 Dual-Token Authentication with Token Family Rotation
- **Access Token:** 15-minute stateless JWT signed with HMAC-SHA256 (`HS256`).
- **Refresh Token:** 7-day cryptographically secure random string (64 bytes).
- **Storage:** Stored only as `SHA-256(rawToken)` in MongoDB. Raw tokens are never persisted.
- **Reuse Detection:** Presenting an already-rotated token invalidates all sessions in the token family (`familyId`), protecting against stolen tokens.
- **TTL Eviction:** MongoDB index on `expiresAt` automatically purges expired tokens from disk.

### 2.4 Append-Only Activity Log
- The `Activity` Mongoose model intercepts all query and document updates/deletions and throws an `AppendOnlyViolationError`.
- Captures all domain mutations (`ISSUE_CREATED`, `STATUS_CHANGED`, `ASSIGNEE_CHANGED`, `PRIORITY_CHANGED`, `PROJECT_MEMBER_REMOVED`, etc.).
