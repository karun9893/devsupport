'use strict';

const AppError = require('../utils/AppError');
const { runInTransaction } = require('../utils/transaction');
const { toObjectId, idEquals } = require('../utils/objectId');
const { ACTIVITY_ACTIONS } = require('../config/constants');
const issueRepository = require('../repositories/issueRepository');
const projectRepository = require('../repositories/projectRepository');
const commentRepository = require('../repositories/commentRepository');
const activityService = require('./activityService');
const { resolveProjectAccess, assertCanViewProject, assertProjectWritable } = require('./accessControl');

const { serializeId } = activityService;

async function loadCommentContext(actor, commentId) {
  const comment = await commentRepository.findById(toObjectId(commentId, 'commentId'));
  if (!comment) throw AppError.notFound('RESOURCE_NOT_FOUND', 'Comment not found.');

  const project = await projectRepository.findById(comment.projectId);
  if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');

  const access = resolveProjectAccess(actor, project);
  assertCanViewProject(access, 'PROJECT_NOT_FOUND', 'Project not found.');

  return { comment, project, access };
}

async function addComment(actor, issueId, { content }) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw AppError.unprocessable('VALIDATION_ERROR', 'Comment content is required.');
  }
  const trimmed = content.trim();
  if (trimmed.length > 3000) {
    throw AppError.unprocessable('VALIDATION_ERROR', 'Comment must be at most 3000 characters.');
  }

  const issue = await issueRepository.findById(toObjectId(issueId, 'issueId'));
  if (!issue) throw AppError.notFound('ISSUE_NOT_FOUND', 'Issue not found.');

  const project = await projectRepository.findById(issue.projectId);
  if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');

  const access = resolveProjectAccess(actor, project);
  assertCanViewProject(access, 'ISSUE_NOT_FOUND', 'Issue not found.');
  assertProjectWritable(project);

  return runInTransaction(async (session) => {
    const comment = await commentRepository.create(
      {
        issueId: issue._id,
        projectId: project._id,
        authorId: toObjectId(actor.id, 'actor.id'),
        content: trimmed,
        isEdited: false,
      },
      { session },
    );

    await activityService.record(
      {
        entityType: 'Issue',
        entityId: issue._id,
        projectId: project._id,
        actorId: toObjectId(actor.id, 'actor.id'),
        actionType: ACTIVITY_ACTIONS.COMMENT_ADDED,
        details: {
          commentId: serializeId(comment._id),
          contentPreview: trimmed.substring(0, 100),
        },
      },
      { session },
    );

    return comment;
  });
}

async function getIssueComments(actor, issueId, { skip = 0, limit = 50 } = {}) {
  const issue = await issueRepository.findById(toObjectId(issueId, 'issueId'));
  if (!issue) throw AppError.notFound('ISSUE_NOT_FOUND', 'Issue not found.');

  const project = await projectRepository.findById(issue.projectId);
  if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');

  const access = resolveProjectAccess(actor, project);
  assertCanViewProject(access, 'ISSUE_NOT_FOUND', 'Issue not found.');

  const [items, total] = await Promise.all([
    commentRepository.findByIssueId(issue._id, { skip, limit }),
    commentRepository.countByIssueId(issue._id),
  ]);

  return { items, total };
}

async function editComment(actor, commentId, { content }) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw AppError.unprocessable('VALIDATION_ERROR', 'Comment content is required.');
  }
  const trimmed = content.trim();
  if (trimmed.length > 3000) {
    throw AppError.unprocessable('VALIDATION_ERROR', 'Comment must be at most 3000 characters.');
  }

  const { comment, project } = await loadCommentContext(actor, commentId);
  assertProjectWritable(project);

  if (!idEquals(comment.authorId, actor.id)) {
    throw AppError.forbidden('FORBIDDEN', 'You can only edit your own comments.');
  }

  return runInTransaction(async (session) => {
    const updated = await commentRepository.updateContent(comment._id, trimmed, { session });

    await activityService.record(
      {
        entityType: 'Issue',
        entityId: comment.issueId,
        projectId: comment.projectId,
        actorId: toObjectId(actor.id, 'actor.id'),
        actionType: ACTIVITY_ACTIONS.COMMENT_EDITED,
        details: {
          commentId: serializeId(comment._id),
        },
      },
      { session },
    );

    return updated;
  });
}

async function deleteComment(actor, commentId) {
  const { comment, project, access } = await loadCommentContext(actor, commentId);
  assertProjectWritable(project);

  const isAuthor = idEquals(comment.authorId, actor.id);
  const canModerate = access.isAdmin || access.isLead;

  if (!isAuthor && !canModerate) {
    throw AppError.forbidden('FORBIDDEN', 'You do not have permission to delete this comment.');
  }

  return runInTransaction(async (session) => {
    await commentRepository.deleteById(comment._id, { session });

    await activityService.record(
      {
        entityType: 'Issue',
        entityId: comment.issueId,
        projectId: comment.projectId,
        actorId: toObjectId(actor.id, 'actor.id'),
        actionType: ACTIVITY_ACTIONS.COMMENT_DELETED,
        details: {
          commentId: serializeId(comment._id),
          deletedBy: serializeId(actor.id),
        },
      },
      { session },
    );

    return { message: 'Comment deleted successfully.' };
  });
}

module.exports = {
  addComment,
  getIssueComments,
  editComment,
  deleteComment,
};
