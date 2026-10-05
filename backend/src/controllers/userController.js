'use strict';

const { User } = require('../models');
const userService = require('../services/userService');
const { USER_ROLES, USER_STATUSES } = require('../config/constants');
const { parsePagination, buildPaginationMetadata } = require('../utils/pagination');
const { sendSuccess, sendPaginated } = require('../utils/response');

async function listUsers(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { search, role } = req.query;

    const filter = {};

    // Standard authenticated users only see Active users; Admin can see all (or filtered by status if provided)
    if (req.user.role !== USER_ROLES.ADMIN) {
      filter.status = USER_STATUSES.ACTIVE;
    } else if (req.query.status && Object.values(USER_STATUSES).includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (role && Object.values(USER_ROLES).includes(role)) {
      filter.role = role;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
      ];
    }

    const [users, totalRecords] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      User.countDocuments(filter).exec(),
    ]);

    const pagination = buildPaginationMetadata(totalRecords, page, limit);
    return sendPaginated(res, 200, users.map((u) => u.toJSON()), pagination);
  } catch (err) {
    next(err);
  }
}

async function updateUserStatus(req, res, next) {
  try {
    const { userId } = req.params;
    const { status } = req.body || {};

    const updated = await userService.setUserStatus(req.user, userId, status);
    return sendSuccess(res, 200, updated);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  updateUserStatus,
};
