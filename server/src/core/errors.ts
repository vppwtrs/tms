/** คลาส error กลางของระบบ — ทุกชั้นโยน AppError และ errorHandler แปลงเป็น JSON */
export class AppError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }
}

export const err = {
  badRequest: (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message),
  unauthorized: (message = 'กรุณาเข้าสู่ระบบ', code = 'UNAUTHORIZED') => new AppError(401, code, message),
  forbidden: (message = 'ไม่มีสิทธิ์เข้าถึง', code = 'FORBIDDEN') => new AppError(403, code, message),
  notFound: (message: string, code = 'NOT_FOUND') => new AppError(404, code, message),
  conflict: (message: string, code = 'CONFLICT') => new AppError(409, code, message),
  invalidState: (message: string) => new AppError(409, 'INVALID_STATE', message),
} as const
