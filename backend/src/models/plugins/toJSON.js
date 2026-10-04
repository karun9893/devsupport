'use strict';

/**
 * Shared toJSON transform: exposes `id` instead of `_id`, strips Mongoose's
 * internal `__v`, and removes any additional sensitive paths passed in.
 * @param {string[]} [hiddenPaths]
 */
function buildToJSON(hiddenPaths = []) {
  return {
    virtuals: false,
    transform(_doc, ret) {
      if (ret._id !== undefined) {
        ret.id = String(ret._id);
        delete ret._id;
      }
      delete ret.__v;
      for (const p of hiddenPaths) delete ret[p];
      return ret;
    },
  };
}

module.exports = { buildToJSON };
