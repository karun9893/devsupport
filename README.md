# DevSupport — Developer Issue & Incident Management System

DevSupport is a placement-grade software engineering project for managing software projects, bugs, technical issues, and incidents.

## Technology Stack

- **Backend:** Node.js, Express.js
- **Database:** MongoDB, Mongoose
- **Security & Authentication:** Dual-Token (JWT 15m + Opaque Hashed Refresh Token 7d with Token Family Rotation), bcryptjs
- **Architecture:** Modular Clean Layered Architecture with ACID Multi-Document Transactions

## Project Structure

```text
devsupport/
├── backend/
│   ├── src/
│   │   ├── config/          # Constants, database connection, env validation
│   │   ├── middleware/      # Error handler, JWT authentication, RBAC
│   │   ├── models/          # Mongoose models & append-only guards
│   │   ├── repositories/    # Data access layer
│   │   ├── services/        # Business logic & transaction orchestration
│   │   ├── utils/           # AppError, crypto, state machine, transaction helpers
│   │   ├── validators/      # Input validation
│   │   ├── app.js           # Express application setup
│   │   └── server.js        # Server entry point
│   ├── scripts/             # Seeding, index sync, replica set instructions
│   └── tests/               # Automated integration tests
└── docs/                    # Architectural & requirements specifications
```

## Running the Application

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and set your MongoDB URI and secrets.

### 3. Run Tests
```bash
npm test
```

### 4. Seed Database
```bash
npm run seed
```

### 5. Start Server
```bash
npm start
```
