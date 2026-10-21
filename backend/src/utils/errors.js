export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg = 'Bad request', details) => new ApiError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to do that') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found') => new ApiError(404, 'NOT_FOUND', msg);
export const conflict = (msg = 'Conflict', details) => new ApiError(409, 'CONFLICT', msg, details);
