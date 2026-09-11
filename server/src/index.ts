import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { db, logActivity, now } from './db.js'
import { signToken, verifyToken } from './auth.js'
import { authenticate, authorize, type AuthRequest } from './middleware.js'
import type { CartItem, InventoryHistoryEntry, PaymentMethod, Product, User, UserRole } from './types.js'

const app = express()
const port = Number(process.env.PORT ?? 4000)
const taxRate = 0.1

app.use(cors())
app.use(express.json())

const streamClients = new Set<express.Response>()
const broadcast = (event: string, payload: unknown) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of streamClients) {
    client.write(message)
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: now() })
})

app.get('/api/stream', (req, res) => {
  const headerToken = typeof req.headers['x-auth-token'] === 'string' ? req.headers['x-auth-token'] : undefined
  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined
  const token = headerToken ?? bearerToken ?? queryToken
  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  try {
    const payload = verifyToken(token)
    if (!db.data.users.some((user) => user.id === payload.userId)) {
      return res.status(401).json({ message: 'User account not found.' })
    }
  } catch {
    return res.status(401).json({ message: 'Invalid token.' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: now() })}\n\n`)
  streamClients.add(res)

  req.on('close', () => {
    streamClients.delete(res)
  })
})

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

app.post('/api/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid login payload.' })
  }

  const user = db.data.users.find((item) => item.username === parsed.data.username)
  if (!user || !bcrypt.compareSync(parsed.data.password, user.passwordHash)) {
    return res.status(401).json({ message: 'Invalid username or password.' })
  }

  const token = signToken(user)
  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  })
})

app.get('/api/auth/me', authenticate, (req: AuthRequest, res) => {
  const user = db.data.users.find((item) => item.id === req.auth?.userId)
  if (!user) {
    return res.status(404).json({ message: 'User not found.' })
  }

  return res.json({ id: user.id, username: user.username, role: user.role })
})

const userSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6).optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER']),
})

app.get('/api/users', authenticate, authorize('ADMIN', 'MANAGER'), (_req, res) => {
  const users = db.data.users.map(({ passwordHash: _passwordHash, ...user }) => user)
  return res.json(users)
})

app.post('/api/users', authenticate, authorize('ADMIN'), (req: AuthRequest, res) => {
  const parsed = userSchema.safeParse(req.body)
  if (!parsed.success || !parsed.data.password) {
    return res.status(400).json({ message: 'Invalid user payload. Password is required.' })
  }

  if (db.data.users.some((item) => item.username === parsed.data.username)) {
    return res.status(409).json({ message: 'Username already exists.' })
  }

  const user: User = {
    id: randomUUID(),
    username: parsed.data.username,
    passwordHash: bcrypt.hashSync(parsed.data.password, 10),
    role: parsed.data.role,
    createdAt: now(),
  }

  db.data.users.push(user)
  db.write()
  logActivity(req.auth!.userId, 'CREATE', 'USER', user.id, `Created ${user.username}`)
  broadcast('users.updated', { id: user.id })

  return res.status(201).json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt })
})

app.put('/api/users/:id', authenticate, authorize('ADMIN'), (req: AuthRequest, res) => {
  const parsed = userSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid user payload.' })
  }

  const user = db.data.users.find((item) => item.id === req.params.id)
  if (!user) {
    return res.status(404).json({ message: 'User not found.' })
  }

  if (parsed.data.username !== user.username && db.data.users.some((item) => item.username === parsed.data.username)) {
    return res.status(409).json({ message: 'Username already exists.' })
  }

  user.username = parsed.data.username
  user.role = parsed.data.role
  if (parsed.data.password) {
    user.passwordHash = bcrypt.hashSync(parsed.data.password, 10)
  }

  db.write()
  logActivity(req.auth!.userId, 'UPDATE', 'USER', user.id, `Updated ${user.username}`)
  broadcast('users.updated', { id: user.id })
  return res.json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt })
})

app.delete('/api/users/:id', authenticate, authorize('ADMIN'), (req: AuthRequest, res) => {
  const userIndex = db.data.users.findIndex((item) => item.id === req.params.id)
  if (userIndex < 0) {
    return res.status(404).json({ message: 'User not found.' })
  }

  const user = db.data.users[userIndex]
  db.data.users.splice(userIndex, 1)
  db.write()
  logActivity(req.auth!.userId, 'DELETE', 'USER', user.id, `Deleted ${user.username}`)
  broadcast('users.updated', { id: user.id })
  return res.status(204).send()
})

const productSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
})

app.get('/api/products', authenticate, (_req, res) => {
  return res.json(db.data.products)
})

app.post('/api/products', authenticate, authorize('ADMIN', 'MANAGER'), (req: AuthRequest, res) => {
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid product payload.' })
  }

  if (db.data.products.some((item) => item.sku === parsed.data.sku)) {
    return res.status(409).json({ message: 'SKU already exists.' })
  }

  const product: Product = {
    id: randomUUID(),
    ...parsed.data,
    createdAt: now(),
    updatedAt: now(),
  }

  db.data.products.push(product)
  const entry: InventoryHistoryEntry = {
    id: randomUUID(),
    productId: product.id,
    type: 'CREATE',
    quantity: product.stock,
    previousStock: 0,
    newStock: product.stock,
    note: 'Initial stock',
    userId: req.auth!.userId,
    createdAt: now(),
  }
  db.data.inventoryHistory.unshift(entry)
  db.write()
  logActivity(req.auth!.userId, 'CREATE', 'PRODUCT', product.id, `Created ${product.name}`)
  broadcast('products.updated', { id: product.id })
  return res.status(201).json(product)
})

app.put('/api/products/:id', authenticate, authorize('ADMIN', 'MANAGER'), (req: AuthRequest, res) => {
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid product payload.' })
  }

  const product = db.data.products.find((item) => item.id === req.params.id)
  if (!product) {
    return res.status(404).json({ message: 'Product not found.' })
  }

  if (parsed.data.sku !== product.sku && db.data.products.some((item) => item.sku === parsed.data.sku)) {
    return res.status(409).json({ message: 'SKU already exists.' })
  }

  if (product.stock !== parsed.data.stock) {
    db.data.inventoryHistory.unshift({
      id: randomUUID(),
      productId: product.id,
      type: 'ADJUSTMENT',
      quantity: parsed.data.stock - product.stock,
      previousStock: product.stock,
      newStock: parsed.data.stock,
      note: 'Stock updated from product edit',
      userId: req.auth!.userId,
      createdAt: now(),
    })
  }

  Object.assign(product, parsed.data, { updatedAt: now() })
  db.write()
  logActivity(req.auth!.userId, 'UPDATE', 'PRODUCT', product.id, `Updated ${product.name}`)
  broadcast('products.updated', { id: product.id })
  return res.json(product)
})

app.delete('/api/products/:id', authenticate, authorize('ADMIN', 'MANAGER'), (req: AuthRequest, res) => {
  const productIndex = db.data.products.findIndex((item) => item.id === req.params.id)
  if (productIndex < 0) {
    return res.status(404).json({ message: 'Product not found.' })
  }

  const product = db.data.products[productIndex]
  db.data.products.splice(productIndex, 1)
  db.data.inventoryHistory.unshift({
    id: randomUUID(),
    productId: product.id,
    type: 'DELETE',
    quantity: -product.stock,
    previousStock: product.stock,
    newStock: 0,
    note: 'Product deleted',
    userId: req.auth!.userId,
    createdAt: now(),
  })
  db.write()
  logActivity(req.auth!.userId, 'DELETE', 'PRODUCT', product.id, `Deleted ${product.name}`)
  broadcast('products.updated', { id: product.id })
  return res.status(204).send()
})

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int(),
  note: z.string().min(1),
})

app.get('/api/inventory/alerts', authenticate, (_req, res) => {
  const lowStockProducts = db.data.products.filter((item) => item.stock <= item.lowStockThreshold)
  return res.json(lowStockProducts)
})

app.get('/api/inventory/history', authenticate, (_req, res) => {
  return res.json(db.data.inventoryHistory)
})

app.post('/api/inventory/adjustments', authenticate, authorize('ADMIN', 'MANAGER'), (req: AuthRequest, res) => {
  const parsed = adjustmentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid adjustment payload.' })
  }

  const product = db.data.products.find((item) => item.id === parsed.data.productId)
  if (!product) {
    return res.status(404).json({ message: 'Product not found.' })
  }

  const newStock = product.stock + parsed.data.quantity
  if (newStock < 0) {
    return res.status(400).json({ message: 'Adjustment would make stock negative.' })
  }

  db.data.inventoryHistory.unshift({
    id: randomUUID(),
    productId: product.id,
    type: 'ADJUSTMENT',
    quantity: parsed.data.quantity,
    previousStock: product.stock,
    newStock,
    note: parsed.data.note,
    userId: req.auth!.userId,
    createdAt: now(),
  })

  product.stock = newStock
  product.updatedAt = now()
  db.write()
  logActivity(req.auth!.userId, 'ADJUST', 'INVENTORY', product.id, parsed.data.note)
  broadcast('inventory.updated', { id: product.id })
  return res.json(product)
})

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  paymentMethod: z.enum(['CASH', 'CARD', 'DIGITAL']),
  cashReceived: z.number().positive().optional(),
})

app.post('/api/sales/checkout', authenticate, (req: AuthRequest, res) => {
  const parsed = checkoutSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid checkout payload.' })
  }

  const items: CartItem[] = []

  for (const item of parsed.data.items) {
    const product = db.data.products.find((productItem) => productItem.id === item.productId)
    if (!product) {
      return res.status(404).json({ message: `Product ${item.productId} not found.` })
    }
    if (product.stock < item.quantity) {
      return res.status(400).json({ message: `Insufficient stock for ${product.name}.` })
    }
    items.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      quantity: item.quantity,
      subtotal: Number((product.price * item.quantity).toFixed(2)),
    })
  }

  const subtotal = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2))
  const tax = Number((subtotal * taxRate).toFixed(2))
  const total = Number((subtotal + tax).toFixed(2))
  const paymentMethod: PaymentMethod = parsed.data.paymentMethod
  const cashReceived = paymentMethod === 'CASH' ? parsed.data.cashReceived : undefined

  if (paymentMethod === 'CASH' && (!cashReceived || cashReceived < total)) {
    return res.status(400).json({ message: 'Cash received must be at least the total amount.' })
  }

  for (const item of items) {
    const product = db.data.products.find((productItem) => productItem.id === item.productId)
    if (!product) {
      continue
    }

    const previousStock = product.stock
    product.stock -= item.quantity
    product.updatedAt = now()

    db.data.inventoryHistory.unshift({
      id: randomUUID(),
      productId: product.id,
      type: 'SALE',
      quantity: -item.quantity,
      previousStock,
      newStock: product.stock,
      note: 'Sold via checkout',
      userId: req.auth!.userId,
      createdAt: now(),
    })
  }

  const createdAt = now()
  const saleId = randomUUID()
  const sale = {
    id: saleId,
    receiptNumber: `R-${Date.now()}`,
    items,
    subtotal,
    tax,
    total,
    paymentMethod,
    cashReceived,
    changeDue: paymentMethod === 'CASH' ? Number((cashReceived! - total).toFixed(2)) : undefined,
    cashierId: req.auth!.userId,
    cashierName: req.auth!.username,
    createdAt,
  }

  db.data.sales.unshift(sale)
  db.write()
  logActivity(req.auth!.userId, 'CREATE', 'SALE', saleId, `Sale total ${total.toFixed(2)}`)
  broadcast('sales.updated', { id: saleId })

  return res.status(201).json({
    ...sale,
    printableReceipt: [
      '=== WEB POS RECEIPT ===',
      `Receipt: ${sale.receiptNumber}`,
      `Date: ${new Date(createdAt).toLocaleString()}`,
      `Cashier: ${sale.cashierName}`,
      '-----------------------',
      ...sale.items.map((item) => `${item.name} x${item.quantity}  $${item.subtotal.toFixed(2)}`),
      '-----------------------',
      `Subtotal: $${subtotal.toFixed(2)}`,
      `Tax: $${tax.toFixed(2)}`,
      `Total: $${total.toFixed(2)}`,
      `Payment: ${sale.paymentMethod}`,
      sale.paymentMethod === 'CASH' ? `Cash: $${sale.cashReceived?.toFixed(2)}` : '',
      sale.paymentMethod === 'CASH' ? `Change: $${sale.changeDue?.toFixed(2)}` : '',
      '=======================',
    ]
      .filter(Boolean)
      .join('\n'),
  })
})

app.get('/api/sales/transactions', authenticate, (_req, res) => {
  return res.json(db.data.sales)
})

const getRangeStart = (range: 'daily' | 'weekly' | 'monthly') => {
  const currentDate = new Date()
  const rangeDate = new Date(currentDate)
  if (range === 'daily') {
    rangeDate.setHours(0, 0, 0, 0)
  } else if (range === 'weekly') {
    rangeDate.setDate(currentDate.getDate() - 7)
  } else {
    rangeDate.setMonth(currentDate.getMonth() - 1)
  }
  return rangeDate
}

const totalRevenue = (sales: typeof db.data.sales) => Number(sales.reduce((sum, sale) => sum + sale.total, 0).toFixed(2))

app.get('/api/reports/sales', authenticate, (req, res) => {
  const range = req.query.range
  if (range !== 'daily' && range !== 'weekly' && range !== 'monthly') {
    return res.status(400).json({ message: 'range must be daily, weekly, or monthly.' })
  }

  const startDate = getRangeStart(range)
  const filteredSales = db.data.sales.filter((sale) => new Date(sale.createdAt) >= startDate)

  return res.json({
    range,
    transactionCount: filteredSales.length,
    totalRevenue: totalRevenue(filteredSales),
    averageOrderValue: filteredSales.length ? Number((totalRevenue(filteredSales) / filteredSales.length).toFixed(2)) : 0,
    sales: filteredSales,
  })
})

app.get('/api/reports/top-products', authenticate, (_req, res) => {
  const productCount = new Map<string, { quantity: number; revenue: number; name: string; sku: string }>()

  db.data.sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const current = productCount.get(item.productId)
      if (current) {
        current.quantity += item.quantity
        current.revenue = Number((current.revenue + item.subtotal).toFixed(2))
      } else {
        productCount.set(item.productId, {
          quantity: item.quantity,
          revenue: item.subtotal,
          name: item.name,
          sku: item.sku,
        })
      }
    })
  })

  const topProducts = [...productCount.entries()]
    .map(([productId, stats]) => ({ productId, ...stats }))
    .sort((first, second) => second.quantity - first.quantity)

  return res.json(topProducts)
})

app.get('/api/reports/revenue', authenticate, (_req, res) => {
  const dailyBuckets = new Map<string, { date: string; revenue: number; transactions: number }>()

  db.data.sales.forEach((sale) => {
    const date = sale.createdAt.slice(0, 10)
    const entry = dailyBuckets.get(date)
    if (entry) {
      entry.revenue = Number((entry.revenue + sale.total).toFixed(2))
      entry.transactions += 1
    } else {
      dailyBuckets.set(date, { date, revenue: sale.total, transactions: 1 })
    }
  })

  return res.json([...dailyBuckets.values()].sort((first, second) => second.date.localeCompare(first.date)))
})

app.get('/api/reports/inventory', authenticate, (_req, res) => {
  const totalStock = db.data.products.reduce((sum, product) => sum + product.stock, 0)
  const stockValue = Number(db.data.products.reduce((sum, product) => sum + product.stock * product.price, 0).toFixed(2))
  const lowStockCount = db.data.products.filter((product) => product.stock <= product.lowStockThreshold).length

  return res.json({
    totalProducts: db.data.products.length,
    totalStock,
    stockValue,
    lowStockCount,
    products: db.data.products,
  })
})

app.get('/api/dashboard/overview', authenticate, (_req, res) => {
  const todayDate = new Date().toISOString().slice(0, 10)
  const todaySales = db.data.sales.filter((sale) => sale.createdAt.startsWith(todayDate))
  const lowStockProducts = db.data.products.filter((product) => product.stock <= product.lowStockThreshold)

  return res.json({
    todaySales: totalRevenue(todaySales),
    todayTransactions: todaySales.length,
    totalRevenue: totalRevenue(db.data.sales),
    totalTransactions: db.data.sales.length,
    lowStockCount: lowStockProducts.length,
    recentTransactions: db.data.sales.slice(0, 10),
    inventoryStatus: lowStockProducts,
  })
})

app.get('/api/activity-logs', authenticate, authorize('ADMIN', 'MANAGER'), (_req, res) => {
  return res.json(db.data.activityLogs)
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error)
  return res.status(500).json({ message: 'Internal server error.' })
})

app.listen(port, () => {
  console.log(`POS backend server running on http://localhost:${port}`)
})
