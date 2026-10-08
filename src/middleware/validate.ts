import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../errors/AppError';

/**
 * Validates req.{body,params,query} against a Zod schema shaped like
 * { body?, params?, query? }, and replaces the request's fields with the
 * *parsed* (coerced/defaulted) values — so downstream code gets clean,
 * typed data instead of raw strings from the wire.
 */
export function validate(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      if (parsed.body) req.body = parsed.body;
      if (parsed.params) req.params = parsed.params;
      if (parsed.query) req.query = parsed.query;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationError('Validation failed', err.flatten().fieldErrors));
      } else {
        next(err);
      }
    }
  };
}
