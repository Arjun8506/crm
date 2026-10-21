import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// validate({ body, query, params }) - parsed (and stripped) values replace the originals,
// so unknown keys never reach controllers (prevents mass assignment).
export const validate = (schemas) => (req, _res, next) => {
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      return next(badRequest('Validation failed', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
    }
    if (part === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true });
    else req[part] = result.data;
  }
  next();
};
