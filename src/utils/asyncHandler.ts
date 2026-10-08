import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express handler so a rejected promise (a thrown error
 * inside an `async` controller) is forwarded to `next()` instead of
 * crashing the process or hanging the request. Without this, every
 * controller would need its own try/catch.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
