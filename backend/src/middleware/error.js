import { ApiError } from '../utils/errors.js';
import { isProd } from '../config/env.js';

export const notFoundHandler = (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found'));

export const errorHandler = (err, req, res, _next) => {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message;
  let details = err.details;

  if (err.code === 11000) {
    status = 409; code = 'CONFLICT'; message = 'A record with that value already exists';
    details = Object.keys(err.keyPattern || {});
  } else if (err.name === 'CastError') {
    status = 400; code = 'BAD_REQUEST'; message = 'Invalid identifier';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_REQUEST'; message = 'Malformed JSON body';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (isProd) message = 'Internal server error';
  }
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
};
