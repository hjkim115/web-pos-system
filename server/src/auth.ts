import jwt from 'jsonwebtoken'
import type { User, UserRole } from './types.js'

const JWT_SECRET = process.env.JWT_SECRET ?? 'development-pos-secret'
const JWT_EXPIRES_IN = '8h'

export interface AuthPayload {
  userId: string
  username: string
  role: UserRole
}

export const signToken = (user: User) =>
  jwt.sign(
    { userId: user.id, username: user.username, role: user.role } satisfies AuthPayload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  )

export const verifyToken = (token: string) => jwt.verify(token, JWT_SECRET) as AuthPayload
