import jwt from 'jsonwebtoken'
import type { User, UserRole } from './types.js'

const isDevelopment = process.env.NODE_ENV === 'development'
const jwtSecretFromEnv = process.env.JWT_SECRET
if (!jwtSecretFromEnv && !isDevelopment) {
  throw new Error('JWT_SECRET must be set when NODE_ENV is not development.')
}

const JWT_SECRET = jwtSecretFromEnv ?? 'development-only-jwt-secret'
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
