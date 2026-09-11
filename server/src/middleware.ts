import type { NextFunction, Request, Response } from 'express'
import { db } from './db.js'
import { verifyToken } from './auth.js'
import type { UserRole } from './types.js'

export interface AuthRequest extends Request {
  auth?: {
    userId: string
    username: string
    role: UserRole
  }
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const headerToken = typeof req.headers['x-auth-token'] === 'string' ? req.headers['x-auth-token'] : null
  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = headerToken ?? bearerToken
  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  try {
    const payload = verifyToken(token)
    const user = db.data.users.find((item) => item.id === payload.userId)
    if (!user) {
      return res.status(401).json({ message: 'User account not found.' })
    }
    req.auth = payload
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid token.' })
  }
}

export const authorize = (...roles: UserRole[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.auth) {
    return res.status(401).json({ message: 'Authentication required.' })
  }
  if (!roles.includes(req.auth.role)) {
    return res.status(403).json({ message: 'Insufficient permissions.' })
  }
  return next()
}
