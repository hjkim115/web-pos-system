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

const defaultAdmin: User = {
  id: randomUUID(),
  username: 'admin',
  passwordHash: bcrypt.hashSync('admin123', 10),
  role: 'ADMIN',
  createdAt: now(),
}

db.read()
if (!db.data.users.length) {
  db.data.users.push(defaultAdmin)
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
