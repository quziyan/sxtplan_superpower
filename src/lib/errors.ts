export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
  }
}

export const Unauthorized = (msg = 'unauthorized') => new AppError(401, 'UNAUTHORIZED', msg)
export const Forbidden = (msg = 'forbidden') => new AppError(403, 'FORBIDDEN', msg)
export const BadRequest = (msg = 'bad request') => new AppError(400, 'BAD_REQUEST', msg)
export const NotFound = (msg = 'not found') => new AppError(404, 'NOT_FOUND', msg)
