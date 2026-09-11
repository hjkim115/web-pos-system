import bcrypt from 'bcryptjs'
import { LowSync } from 'lowdb'
import { JSONFileSync } from 'lowdb/node'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { ActivityLog, DatabaseSchema, User } from './types.js'

const dbPath = resolve(process.cwd(), 'data/db.json')
const adapter = new JSONFileSync<DatabaseSchema>(dbPath)

export const db = new LowSync<DatabaseSchema>(adapter, {
  users: [],
  products: [],
  sales: [],
  inventoryHistory: [],
  activityLogs: [],
})

export const now = () => new Date().toISOString()

const defaultDatabaseState = (): DatabaseSchema => ({
  users: [],
  products: [],
  sales: [],
  inventoryHistory: [],
  activityLogs: [],
})

const isDevelopment = process.env.NODE_ENV === 'development'
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD

if (!defaultAdminPassword && !isDevelopment) {
  throw new Error('DEFAULT_ADMIN_PASSWORD must be set when NODE_ENV is not development.')
}

export const initializeDatabase = async () => {
  db.read()
  db.data ||= defaultDatabaseState()
  if (!db.data.users.length) {
    const defaultAdmin: User = {
      id: randomUUID(),
      username: 'admin',
      passwordHash: await bcrypt.hash(defaultAdminPassword ?? 'admin123', 10),
      role: 'ADMIN',
      createdAt: now(),
    }
    db.data.users.push(defaultAdmin)
  }
  db.write()
}

export const logActivity = (
  userId: string,
  action: string,
  entity: string,
  entityId: string,
  details: string,
) => {
  const entry: ActivityLog = {
    id: randomUUID(),
    userId,
    action,
    entity,
    entityId,
    details,
    createdAt: now(),
  }
  db.data.activityLogs.unshift(entry)
  db.data.activityLogs = db.data.activityLogs.slice(0, 1000)
  db.write()
}
