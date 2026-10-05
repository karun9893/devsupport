'use strict';

const activityService = require('../services/activityService');
const projectService = require('../services/projectService');
const issueService = require('../services/issueService');
const { Activity } = require('../models');
const { ACTIVITY_ENTITY_TYPES } = require('../config/constants');
const { parsePagination, buildPaginationMetadata } = require('../utils/pagination');
const { sendPaginated } = require('../utils/response');

async function getIssueActivity(req, res, next) {
  try {
    const { issueId } = req.params;

    // Verify issue access
    const issue = await issueService.getIssue(req.user, issueId);

    const { page, limit, skip } = parsePagination(req.query);

    const [items, totalRecords] = await Promise.all([
      activityService.listForEntity(issue._id, { skip, limit }),
      Activity.countDocuments({ entityId: issue._id }).exec(),
    ]);

    const pagination = buildPaginationMetadata(totalRecords, page, limit);
    return sendPaginated(res, 200, items.map((a) => a.toJSON()), pagination);
  } catch (err) {
    next(err);
  }
}

async function getProjectActivity(req, res, next) {
  try {
    const { projectId } = req.params;

    // Verify project access
    const project = await projectService.getProject(req.user, projectId);

    const { page, limit, skip } = parsePagination(req.query);

    const [items, totalRecords] = await Promise.all([
      activityService.listForProject(project._id, { skip, limit }),
      Activity.countDocuments({ projectId: project._id }).exec(),
    ]);

    const pagination = buildPaginationMetadata(totalRecords, page, limit);
    return sendPaginated(res, 200, items.map((a) => a.toJSON()), pagination);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getIssueActivity,
  getProjectActivity,
};
