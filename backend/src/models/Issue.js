'use strict';

const mongoose = require('mongoose');
const {
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_KEY_REGEX,
} = require('../config/constants');
const { STATUSES_REQUIRING_ASSIGNEE } = require('../utils/issueStateMachine');
const { buildToJSON } = require('./plugins/toJSON');

const { ObjectId } = mongoose.Schema.Types;

/**
 * Issue — Phase 2 §3.4.
 *
 * Optimistic concurrency: `version` is the Mongoose version key with
 * `optimisticConcurrency: true`, so document `save()` calls are version-checked
 * automatically. Atomic `findOneAndUpdate` paths (used by the services) match on
 * `version` explicitly and `$inc` it — see issueRepository.updateWithVersion.
 */
const issueSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'Issue key is required.'],
      immutable: true,
      match: [ISSUE_KEY_REGEX, 'Issue key must have the form PROJECT_KEY-<number>, e.g. DEV-101.'],
    },
    issueNumber: {
      type: Number,
      required: [true, 'Issue number is required.'],
      immutable: true,
      min: [1, 'Issue number must be >= 1.'],
      validate: { validator: Number.isInteger, message: 'Issue number must be an integer.' },
    },
    projectId: { type: ObjectId, ref: 'Project', required: [true, 'projectId is required.'], immutable: true },
    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true,
      minlength: [5, 'Title must be at least 5 characters.'],
      maxlength: [150, 'Title must be at most 150 characters.'],
    },
    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters.'],
      maxlength: [5000, 'Description must be at most 5000 characters.'],
    },
    type: {
      type: String,
      required: [true, 'Issue type is required.'],
      enum: { values: Object.values(ISSUE_TYPES), message: 'Invalid issue type: {VALUE}.' },
    },
    priority: {
      type: String,
      required: true,
      enum: { values: Object.values(ISSUE_PRIORITIES), message: 'Invalid priority: {VALUE}.' },
      default: ISSUE_PRIORITIES.MEDIUM,
    },
    status: {
      type: String,
      required: true,
      enum: { values: Object.values(ISSUE_STATUSES), message: 'Invalid status: {VALUE}.' },
      default: ISSUE_STATUSES.OPEN,
    },
    reporterId: { type: ObjectId, ref: 'User', required: [true, 'reporterId is required.'], immutable: true },
    assigneeId: { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    versionKey: 'version',
    optimisticConcurrency: true,
    toJSON: buildToJSON(),
  },
);

// Core invariant: issue numbers are unique per project (Phase 2 §3.4 / §4.3).
issueSchema.index({ projectId: 1, issueNumber: 1 }, { unique: true, name: 'uniq_project_issueNumber' });
issueSchema.index({ key: 1 }, { unique: true, name: 'uniq_key' });
// Faceted queue listing: filter by project/status/priority, newest first.
issueSchema.index({ projectId: 1, status: 1, priority: 1, createdAt: -1 }, { name: 'project_status_priority_createdAt' });
// Offboarding checks and "My Issues" work queues.
issueSchema.index({ projectId: 1, assigneeId: 1, status: 1 }, { name: 'project_assignee_status' });
// Full-text search (?q=).
issueSchema.index(
  { key: 'text', title: 'text', description: 'text' },
  { name: 'issue_text_search', weights: { key: 10, title: 5, description: 1 } },
);

issueSchema.pre('validate', async function validateIssueInvariants() {
  if (this.key && Number.isInteger(this.issueNumber) && !this.key.endsWith(`-${this.issueNumber}`)) {
    this.invalidate('key', `Issue key "${this.key}" does not match issueNumber ${this.issueNumber}.`);
  }
  if (STATUSES_REQUIRING_ASSIGNEE.includes(this.status) && !this.assigneeId) {
    this.invalidate('assigneeId', `An issue in status ${this.status} must have an assignee.`);
  }
});

module.exports = mongoose.models.Issue || mongoose.model('Issue', issueSchema);
