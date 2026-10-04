'use strict';

const mongoose = require('mongoose');
const { buildToJSON } = require('./plugins/toJSON');

const { ObjectId } = mongoose.Schema.Types;

/** Comment — Phase 2 §3.5. */
const commentSchema = new mongoose.Schema(
  {
    issueId: { type: ObjectId, ref: 'Issue', required: [true, 'issueId is required.'], immutable: true },
    projectId: { type: ObjectId, ref: 'Project', required: [true, 'projectId is required.'], immutable: true },
    authorId: { type: ObjectId, ref: 'User', required: [true, 'authorId is required.'], immutable: true },
    content: {
      type: String,
      required: [true, 'Comment content is required.'],
      trim: true,
      minlength: [1, 'Comment cannot be empty.'],
      maxlength: [3000, 'Comment must be at most 3000 characters.'],
    },
    isEdited: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, toJSON: buildToJSON() },
);

commentSchema.index({ issueId: 1, createdAt: 1 }, { name: 'issue_createdAt' });
commentSchema.index({ authorId: 1 }, { name: 'authorId' });

module.exports = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
