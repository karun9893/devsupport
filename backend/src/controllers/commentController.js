'use strict';

const commentService = require('../services/commentService');
const { parsePagination, buildPaginationMetadata } = require('../utils/pagination');
const { sendSuccess, sendPaginated } = require('../utils/response');

async function addComment(req, res, next) {
  try {
    const { issueId } = req.params;
    const { content } = req.body || {};

    const comment = await commentService.addComment(req.user, issueId, { content });
    return sendSuccess(res, 201, comment.toJSON());
  } catch (err) {
    next(err);
  }
}

async function listComments(req, res, next) {
  try {
    const { issueId } = req.params;
    const { page, limit, skip } = parsePagination(req.query);

    const { items, total } = await commentService.getIssueComments(req.user, issueId, {
      skip,
      limit,
    });

    const pagination = buildPaginationMetadata(total, page, limit);
    return sendPaginated(res, 200, items.map((c) => c.toJSON()), pagination);
  } catch (err) {
    next(err);
  }
}

async function editComment(req, res, next) {
  try {
    const { commentId } = req.params;
    const { content } = req.body || {};

    const updated = await commentService.editComment(req.user, commentId, { content });
    return sendSuccess(res, 200, updated.toJSON());
  } catch (err) {
    next(err);
  }
}

async function deleteComment(req, res, next) {
  try {
    const { commentId } = req.params;

    const result = await commentService.deleteComment(req.user, commentId);
    return sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addComment,
  listComments,
  editComment,
  deleteComment,
};
