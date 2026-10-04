'use strict';

const mongoose = require('mongoose');

/**
 * Runs `work(session)` inside a MongoDB multi-document ACID transaction.
 *
 * - Uses the driver's `withTransaction`, which automatically retries the
 *   callback on TransientTransactionError (e.g. write conflicts) and retries the
 *   commit on UnknownTransactionCommitResult.
 * - Any other error (including AppError) aborts the transaction and propagates.
 * - `work` MUST pass `session` to every database operation and MUST NOT perform
 *   non-idempotent external side effects, because it may be re-executed.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { runInTransaction };
