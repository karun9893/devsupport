'use strict';

/**
 * Parses and sanitizes standard pagination query parameters.
 * Phase 3 §7.1: page >= 1 (default 1), limit 1..100 (default 20). Clamps limit > 100 to 100.
 */
function parsePagination(query = {}) {
  let page = parseInt(query.page, 10);
  if (isNaN(page) || page < 1) page = 1;

  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

function buildPaginationMetadata(totalRecords, page, limit) {
  const totalPages = Math.ceil(totalRecords / limit) || (totalRecords === 0 ? 0 : 1);
  return {
    currentPage: page,
    limit,
    totalRecords,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1 && page <= totalPages + 1,
  };
}

module.exports = {
  parsePagination,
  buildPaginationMetadata,
};
