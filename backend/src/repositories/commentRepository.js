'use strict';

const { Comment } = require('../models');

async function create(data, { session } = {}) {
  const comment = new Comment(data);
  await comment.save({ session });
  return comment;
}

async function findById(id, { session } = {}) {
  return Comment.findById(id).session(session || null).exec();
}

async function findByIssueId(issueId, { skip = 0, limit = 50, session } = {}) {
  return Comment.find({ issueId })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .populate('authorId', 'name email role')
    .session(session || null)
    .exec();
}

async function countByIssueId(issueId, { session } = {}) {
  return Comment.countDocuments({ issueId }).session(session || null).exec();
}

async function updateContent(id, content, { session } = {}) {
  return Comment.findByIdAndUpdate(
    id,
    { $set: { content, isEdited: true } },
    { new: true, runValidators: true, session },
  ).exec();
}

async function deleteById(id, { session } = {}) {
  return Comment.findByIdAndDelete(id, { session }).exec();
}

module.exports = {
  create,
  findById,
  findByIssueId,
  countByIssueId,
  updateContent,
  deleteById,
};
