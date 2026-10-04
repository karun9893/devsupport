'use strict';

const mongoose = require('mongoose');

const COUNTER_ID_PREFIX = 'issue_seq_';

/**
 * Counter — Phase 2 §3.3 / §4.
 * One document per project, holding the highest issue number issued so far.
 * Kept in its own collection so high-frequency increments never contend with
 * reads/updates of the Project document.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      match: [/^issue_seq_[a-f0-9]{24}$/, 'Counter _id must be issue_seq_<projectId>.'],
    },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    seq: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Counter sequence cannot be negative.'],
      validate: { validator: Number.isInteger, message: 'Counter sequence must be an integer.' },
    },
  },
  { versionKey: false, timestamps: false },
);

counterSchema.index({ projectId: 1 }, { unique: true, name: 'uniq_projectId' });

counterSchema.statics.counterIdFor = function counterIdFor(projectId) {
  return `${COUNTER_ID_PREFIX}${String(projectId)}`;
};

/**
 * Atomically increments and returns the next issue number for a project.
 * A single findOneAndUpdate with $inc is atomic at the document level, so
 * concurrent callers always receive distinct values.
 *
 * @param {import('mongoose').Types.ObjectId|string} projectId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<number>}
 */
counterSchema.statics.nextSequence = async function nextSequence(projectId, { session } = {}) {
  const filter = { _id: this.counterIdFor(projectId) };
  const update = { $inc: { seq: 1 }, $setOnInsert: { projectId } };
  const options = { returnDocument: 'after', upsert: true, session, lean: true };

  try {
    const doc = await this.findOneAndUpdate(filter, update, options);
    return doc.seq;
  } catch (err) {
    // Two first-ever upserts can race on the unique _id. The server normally
    // retries this itself; one client-side retry covers older deployments.
    if (err && err.code === 11000) {
      const doc = await this.findOneAndUpdate(filter, update, options);
      return doc.seq;
    }
    throw err;
  }
};

module.exports = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
