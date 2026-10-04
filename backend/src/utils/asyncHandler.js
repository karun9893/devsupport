'use strict';

/** Forwards async errors to Express' error pipeline (Express 4 does not do this natively). */
module.exports = function asyncHandler(fn) {
  return function asyncHandlerWrapper(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
