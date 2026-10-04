'use strict';

const mongoose = require('mongoose');
const { ACTIVITY_ENTITY_TYPES, ACTIVITY_ACTIONS } = require('../config/constants');
const { buildToJSON } = require('./plugins/toJSON');

const { ObjectId, Mixed } = mongoose.Schema.Types;

const detailsSchema = new mongoose.Schema(
  {
    oldValue: { type: Mixed, default: null },
    newValue: { type: Mixed, default: null },
    reason: { type: String, trim: true, maxlength: 1000, default: null },
  },
  { _id: false, minimize: false },
);

/**
 * Activity (audit log) — Phase 2 §3.6.
 * STRICTLY APPEND-ONLY: every Mongoose update/replace/delete path is blocked
 * below. Only inserts (save on a new document / insertMany / create) succeed.
 *
 * Note: this guards the application's data-access layer. In production the
 * application's MongoDB user should additionally be denied `update`/`remove`
 * on this collection via a custom role (defence-in-depth against raw-driver access).
 */
const activitySchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      immutable: true,
      enum: { values: Object.values(ACTIVITY_ENTITY_TYPES), message: 'Invalid entityType: {VALUE}.' },
    },
    entityId: { type: ObjectId, required: true, immutable: true, refPath: 'entityType' },
    projectId: { type: ObjectId, ref: 'Project', required: true, immutable: true },
    actorId: { type: ObjectId, ref: 'User', required: true, immutable: true },
    actionType: {
      type: String,
      required: true,
      immutable: true,
      enum: { values: Object.values(ACTIVITY_ACTIONS), message: 'Invalid actionType: {VALUE}.' },
    },
    details: { type: detailsSchema, required: true, default: () => ({}) },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: buildToJSON(),
  },
);

activitySchema.index({ entityId: 1, createdAt: -1 }, { name: 'entity_createdAt' });
activitySchema.index({ projectId: 1, createdAt: -1 }, { name: 'project_createdAt' });

// ---------------------------------------------------------------------------
// Append-only enforcement
// ---------------------------------------------------------------------------

function appendOnlyError(operation) {
  const err = new Error(`Activity log is append-only: "${operation}" is not permitted.`);
  err.name = 'AppendOnlyViolationError';
  err.code = 'APPEND_ONLY_VIOLATION';
  return err;
}

const BLOCKED_QUERY_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

activitySchema.pre(BLOCKED_QUERY_OPERATIONS, { document: false, query: true }, async function blockQueryMutation() {
  throw appendOnlyError(this.op);
});

activitySchema.pre(['updateOne', 'deleteOne'], { document: true, query: false }, async function blockDocumentMutation() {
  throw appendOnlyError('document mutation');
});

activitySchema.pre('save', async function blockResave() {
  if (!this.isNew) throw appendOnlyError('save on existing document');
});

activitySchema.pre('bulkWrite', async function blockBulkMutation(next, ops) {
  const operations = Array.isArray(next) ? next : ops;
  const offending = (operations || []).find((op) => !Object.prototype.hasOwnProperty.call(op, 'insertOne'));
  if (offending) throw appendOnlyError(`bulkWrite:${Object.keys(offending)[0]}`);
});

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
module.exports.appendOnlyError = appendOnlyError;
