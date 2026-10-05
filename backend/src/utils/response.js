'use strict';

/**
 * Standard HTTP success and paginated response helpers.
 * Conforms strictly to Phase 3 §3.1 & §3.2 envelopes.
 */

function sendSuccess(res, statusCode, data) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

function sendPaginated(res, statusCode, items, pagination) {
  return res.status(statusCode).json({
    success: true,
    data: items,
    pagination: {
      currentPage: pagination.currentPage,
      limit: pagination.limit,
      totalRecords: pagination.totalRecords,
      totalPages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
      hasPrevPage: pagination.hasPrevPage,
    },
  });
}

module.exports = {
  sendSuccess,
  sendPaginated,
};
