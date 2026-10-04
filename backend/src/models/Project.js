'use strict';

const mongoose = require('mongoose');
const { PROJECT_STATUSES, PROJECT_ROLES, PROJECT_KEY_REGEX } = require('../config/constants');
const { buildToJSON } = require('./plugins/toJSON');

const { ObjectId } = mongoose.Schema.Types;

/** ProjectMember subdocument — Phase 2 §3.2. */
const projectMemberSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: [true, 'Member userId is required.'] },
    projectRole: {
      type: String,
      required: [true, 'Member projectRole is required.'],
      enum: { values: Object.values(PROJECT_ROLES), message: 'Invalid project role: {VALUE}.' },
    },
    joinedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

/** Project — Phase 2 §3.2. */
const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required.'],
      trim: true,
      minlength: [3, 'Project name must be at least 3 characters.'],
      maxlength: [80, 'Project name must be at most 80 characters.'],
    },
    key: {
      type: String,
      required: [true, 'Project key is required.'],
      trim: true,
      immutable: true, // issue keys embed this prefix; it can never change
      match: [PROJECT_KEY_REGEX, 'Project key must match ^[A-Z][A-Z0-9]{1,9}$ (2-10 uppercase alphanumerics, starting with a letter).'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description must be at most 1000 characters.'],
      default: '',
    },
    ownerId: { type: ObjectId, ref: 'User', required: [true, 'Project owner is required.'] },
    status: {
      type: String,
      required: true,
      enum: { values: Object.values(PROJECT_STATUSES), message: 'Invalid project status: {VALUE}.' },
      default: PROJECT_STATUSES.ACTIVE,
    },
    members: { type: [projectMemberSchema], default: [] },
  },
  { timestamps: true, toJSON: buildToJSON() },
);

projectSchema.index({ key: 1 }, { unique: true, name: 'uniq_key' });
projectSchema.index({ name: 1 }, { unique: true, name: 'uniq_name' });
projectSchema.index({ 'members.userId': 1 }, { name: 'members_userId' });
projectSchema.index({ status: 1 }, { name: 'status' });

/**
 * Document-level roster invariants (Phase 2 §3.2):
 *  - the roster is non-empty and contains no duplicate users;
 *  - the owner is an enrolled member with projectRole = Lead
 *    (which also guarantees "at least one Lead").
 *
 * Atomic update paths (add/remove member) cannot run document hooks, so the
 * service layer enforces the same invariants via guarded update filters
 * (see projectRepository.removeMember: the owner can never be pulled).
 */
projectSchema.pre('validate', async function validateRoster() {
  const members = this.members || [];
  if (members.length === 0) {
    this.invalidate('members', 'A project must have at least one member (its Lead owner).');
    return;
  }

  const seen = new Set();
  for (const m of members) {
    const id = String(m.userId);
    if (seen.has(id)) {
      this.invalidate('members', `User ${id} is enrolled more than once.`);
      return;
    }
    seen.add(id);
  }

  const owner = members.find((m) => String(m.userId) === String(this.ownerId));
  if (!owner || owner.projectRole !== PROJECT_ROLES.LEAD) {
    this.invalidate('ownerId', 'The project owner must be an enrolled member with projectRole "Lead".');
  }
});

projectSchema.methods.findMember = function findMember(userId) {
  return (this.members || []).find((m) => String(m.userId) === String(userId)) || null;
};

projectSchema.methods.isArchived = function isArchived() {
  return this.status === PROJECT_STATUSES.ARCHIVED;
};

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
