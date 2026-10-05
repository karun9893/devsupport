'use strict';

const { Issue } = require('../models');
const issueService = require('../services/issueService');
const projectService = require('../services/projectService');
const { isValidObjectId, toObjectId } = require('../utils/objectId');
const { parsePagination, buildPaginationMetadata } = require('../utils/pagination');
const { sendSuccess, sendPaginated } = require('../utils/response');
const { validateIssueType, validateIssuePriority } = require('../validators/commonValidators');
const { ISSUE_STATUSES, ISSUE_PRIORITIES } = require('../config/constants');
const AppError = require('../utils/AppError');

async function createIssue(req, res, next) {
  try {
    const { projectId } = req.params;
    const { title, description, type, priority, assigneeId } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 150) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Title must be between 5 and 150 characters.');
    }

    if (!description || typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 5000) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Description must be between 10 and 5000 characters.');
    }

    const validatedType = validateIssueType(type);
    const validatedPriority = priority ? validateIssuePriority(priority) : ISSUE_PRIORITIES.MEDIUM;

    const issue = await issueService.createIssue(req.user, projectId, {
      title: title.trim(),
      description: description.trim(),
      type: validatedType,
      priority: validatedPriority,
      assigneeId: assigneeId || null,
    });

    return sendSuccess(res, 201, issue.toJSON());
  } catch (err) {
    next(err);
  }
}

async function listProjectIssues(req, res, next) {
  try {
    const { projectId } = req.params;

    // Verify access to project first (will throw 404 PROJECT_NOT_FOUND if unauthorized or not found)
    const project = await projectService.getProject(req.user, projectId);

    const { page, limit, skip } = parsePagination(req.query);
    const { status, priority, type, assigneeId, reporterId, q, sortBy = 'createdAt', order = 'desc' } = req.query;

    const filter = { projectId: project._id };

    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        filter.status = { $in: statuses };
      }
    }

    if (priority) {
      const priorities = priority.split(',').map((p) => p.trim()).filter(Boolean);
      if (priorities.length > 0) {
        filter.priority = { $in: priorities };
      }
    }

    if (type) {
      const types = type.split(',').map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        filter.type = { $in: types };
      }
    }

    if (assigneeId) {
      if (assigneeId === 'unassigned') {
        filter.assigneeId = null;
      } else if (isValidObjectId(assigneeId)) {
        filter.assigneeId = toObjectId(assigneeId, 'assigneeId');
      }
    }

    if (reporterId && isValidObjectId(reporterId)) {
      filter.reporterId = toObjectId(reporterId, 'reporterId');
    }

    if (q && typeof q === 'string' && q.trim()) {
      filter.$text = { $search: q.trim() };
    }

    const sortOrder = order === 'asc' ? 1 : -1;

    let issues;
    let totalRecords;

    if (sortBy === 'priority') {
      // Priority urgency weighting: Critical (4) > High (3) > Medium (2) > Low (1)
      const priorityWeightPipeline = [
        { $match: filter },
        {
          $addFields: {
            priorityWeight: {
              $switch: {
                branches: [
                  { case: { $eq: ['$priority', 'Critical'] }, then: 4 },
                  { case: { $eq: ['$priority', 'High'] }, then: 3 },
                  { case: { $eq: ['$priority', 'Medium'] }, then: 2 },
                  { case: { $eq: ['$priority', 'Low'] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
        },
        { $sort: { priorityWeight: sortOrder, _id: sortOrder } },
        { $skip: skip },
        { $limit: limit },
      ];

      const [aggregateResults, count] = await Promise.all([
        Issue.aggregate(priorityWeightPipeline).exec(),
        Issue.countDocuments(filter).exec(),
      ]);

      issues = aggregateResults.map((doc) => {
        const docObj = { ...doc };
        docObj.id = String(docObj._id);
        delete docObj._id;
        delete docObj.__v;
        delete docObj.priorityWeight;
        return docObj;
      });
      totalRecords = count;
    } else {
      const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'title'];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const sortObj = { [sortField]: sortOrder, _id: sortOrder };

      const [docs, count] = await Promise.all([
        Issue.find(filter)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .exec(),
        Issue.countDocuments(filter).exec(),
      ]);

      issues = docs.map((doc) => doc.toJSON());
      totalRecords = count;
    }

    const pagination = buildPaginationMetadata(totalRecords, page, limit);
    return sendPaginated(res, 200, issues, pagination);
  } catch (err) {
    next(err);
  }
}

async function getIssue(req, res, next) {
  try {
    const { issueId } = req.params;

    let targetId = issueId;
    if (!isValidObjectId(issueId)) {
      // Try resolving by Jira-style key
      const found = await Issue.findOne({ key: issueId.toUpperCase() });
      if (!found) {
        throw AppError.notFound('ISSUE_NOT_FOUND', 'Issue not found.');
      }
      targetId = found._id;
    }

    const issue = await issueService.getIssue(req.user, targetId);
    return sendSuccess(res, 200, issue.toJSON());
  } catch (err) {
    next(err);
  }
}

async function transitionIssue(req, res, next) {
  try {
    const { issueId } = req.params;
    const { toStatus, expectedVersion, reason } = req.body || {};

    const updated = await issueService.transitionIssue(req.user, issueId, {
      toStatus,
      expectedVersion,
      reason,
    });

    return sendSuccess(res, 200, updated.toJSON());
  } catch (err) {
    next(err);
  }
}

async function assignIssue(req, res, next) {
  try {
    const { issueId } = req.params;
    const { assigneeId, expectedVersion } = req.body || {};

    const updated = await issueService.assignIssue(req.user, issueId, {
      assigneeId,
      expectedVersion,
    });

    return sendSuccess(res, 200, updated.toJSON());
  } catch (err) {
    next(err);
  }
}

async function changePriority(req, res, next) {
  try {
    const { issueId } = req.params;
    const { priority, expectedVersion } = req.body || {};

    const updated = await issueService.changePriority(req.user, issueId, {
      priority,
      expectedVersion,
    });

    return sendSuccess(res, 200, updated.toJSON());
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createIssue,
  listProjectIssues,
  getIssue,
  transitionIssue,
  assignIssue,
  changePriority,
};
