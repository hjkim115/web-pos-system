export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER'

export interface User {
  id: string
  username: string
  passwordHash: string
  role: UserRole
  createdAt: string
}

export interface Product {
  id: string
  name: string
  category: string
  sku: string
  price: number
  stock: number
  lowStockThreshold: number
  createdAt: string
  updatedAt: string
}

export interface CartItem {
  productId: string
  name: string
  sku: string
  price: number
  quantity: number
  subtotal: number
}

export type PaymentMethod = 'CASH' | 'CARD' | 'DIGITAL'

export interface Sale {
  id: string
  receiptNumber: string
  items: CartItem[]
  subtotal: number
  tax: number
  total: number
  paymentMethod: PaymentMethod
  cashReceived?: number
  changeDue?: number
  cashierId: string
  cashierName: string
  createdAt: string
}

export type InventoryChangeType = 'CREATE' | 'SALE' | 'ADJUSTMENT' | 'DELETE'

export interface InventoryHistoryEntry {
  id: string
  productId: string
  type: InventoryChangeType
  quantity: number
  previousStock: number
  newStock: number
  note: string
  userId: string
  createdAt: string
}

export interface ActivityLog {
  id: string
  userId: string
  action: string
  entity: string
  entityId: string
  details: string
  createdAt: string
}

export interface DatabaseSchema {
  users: User[]
  products: Product[]
  sales: Sale[]
  inventoryHistory: InventoryHistoryEntry[]
  activityLogs: ActivityLog[]
}
