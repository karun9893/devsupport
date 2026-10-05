'use strict';

const { Project } = require('../models');
const projectService = require('../services/projectService');
const { USER_ROLES, PROJECT_STATUSES } = require('../config/constants');
const { validateProjectKey } = require('../validators/commonValidators');
const { parsePagination, buildPaginationMetadata } = require('../utils/pagination');
const { sendSuccess, sendPaginated } = require('../utils/response');
const AppError = require('../utils/AppError');

async function createProject(req, res, next) {
  try {
    const { name, key, description } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 80) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Project name must be between 3 and 80 characters.');
    }

    const validatedKey = validateProjectKey(key);

    if (description !== undefined && description !== null && typeof description !== 'string') {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Project description must be a string.');
    }
    if (typeof description === 'string' && description.length > 1000) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Project description must be at most 1000 characters.');
    }

    const project = await projectService.createProject(req.user, {
      name: name.trim(),
      key: validatedKey,
      description: typeof description === 'string' ? description.trim() : '',
    });

    return sendSuccess(res, 201, project.toJSON());
  } catch (err) {
    next(err);
  }
}

async function listProjects(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;

    const filter = {};

    // Admin sees all projects; Team Lead and Developer see only enrolled projects
    if (req.user.role !== USER_ROLES.ADMIN) {
      filter['members.userId'] = req.user.id;
    }

    if (status && Object.values(PROJECT_STATUSES).includes(status)) {
      filter.status = status;
    }

    const [projects, totalRecords] = await Promise.all([
      Project.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      Project.countDocuments(filter).exec(),
    ]);

    const pagination = buildPaginationMetadata(totalRecords, page, limit);
    return sendPaginated(res, 200, projects.map((p) => p.toJSON()), pagination);
  } catch (err) {
    next(err);
  }
}

async function getProject(req, res, next) {
  try {
    const { projectId } = req.params;
    const project = await projectService.getProject(req.user, projectId);
    return sendSuccess(res, 200, project.toJSON());
  } catch (err) {
    next(err);
  }
}

async function archiveProject(req, res, next) {
  try {
    const { projectId } = req.params;
    const { reason } = req.body || {};

    const project = await projectService.archiveProject(req.user, projectId, {
      reason: typeof reason === 'string' ? reason.trim() : null,
    });

    return sendSuccess(res, 200, project.toJSON());
  } catch (err) {
    next(err);
  }
}

async function addMember(req, res, next) {
  try {
    const { projectId } = req.params;
    const { userId, projectRole } = req.body || {};

    if (!userId) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'userId is required.');
    }

    const project = await projectService.addMember(req.user, projectId, {
      userId,
      projectRole,
    });

    return sendSuccess(res, 200, project.toJSON());
  } catch (err) {
    next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const { projectId, userId } = req.params;
    const directive = req.body || {};

    const result = await projectService.removeMember(req.user, projectId, userId, directive);
    return sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createProject,
  listProjects,
  getProject,
  archiveProject,
  addMember,
  removeMember,
};
