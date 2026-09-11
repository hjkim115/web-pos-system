import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type Role = 'ADMIN' | 'MANAGER' | 'CASHIER'
type PaymentMethod = 'CASH' | 'CARD' | 'DIGITAL'

type User = {
  id: string
  username: string
  role: Role
}

type Product = {
  id: string
  name: string
  category: string
  sku: string
  price: number
  stock: number
  lowStockThreshold: number
}

type Sale = {
  id: string
  receiptNumber: string
  items: Array<{ name: string; quantity: number; subtotal: number }>
  subtotal: number
  tax: number
  total: number
  paymentMethod: PaymentMethod
  cashReceived?: number
  changeDue?: number
  cashierName: string
  createdAt: string
}

type InventoryHistoryEntry = {
  id: string
  productId: string
  type: string
  quantity: number
  previousStock: number
  newStock: number
  note: string
  createdAt: string
}

type DashboardOverview = {
  todaySales: number
  todayTransactions: number
  totalRevenue: number
  totalTransactions: number
  lowStockCount: number
  recentTransactions: Sale[]
  inventoryStatus: Product[]
}

type SalesReport = {
  range: 'daily' | 'weekly' | 'monthly'
  transactionCount: number
  totalRevenue: number
  averageOrderValue: number
}

type TopProduct = {
  productId: string
  name: string
  sku: string
  quantity: number
  revenue: number
}

type RevenuePoint = {
  date: string
  revenue: number
  transactions: number
}

type InventoryReport = {
  totalProducts: number
  totalStock: number
  stockValue: number
  lowStockCount: number
}

type Tab = 'DASHBOARD' | 'POS' | 'PRODUCTS' | 'INVENTORY' | 'REPORTS' | 'USERS'

const tabs: Tab[] = ['DASHBOARD', 'POS', 'PRODUCTS', 'INVENTORY', 'REPORTS', 'USERS']
const apiBase = '/api'

const formatCurrency = (value: number) => `$${value.toFixed(2)}`

function App() {
  const [token, setToken] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [activeTab, setActiveTab] = useState<Tab>('DASHBOARD')
  const [message, setMessage] = useState('')

  const [products, setProducts] = useState<Product[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const [inventoryHistory, setInventoryHistory] = useState<InventoryHistoryEntry[]>([])
  const [transactions, setTransactions] = useState<Sale[]>([])
  const [dashboard, setDashboard] = useState<DashboardOverview | null>(null)
  const [salesReport, setSalesReport] = useState<SalesReport | null>(null)
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [revenuePoints, setRevenuePoints] = useState<RevenuePoint[]>([])
  const [inventoryReport, setInventoryReport] = useState<InventoryReport | null>(null)

  const [productForm, setProductForm] = useState({
    id: '',
    name: '',
    category: '',
    sku: '',
    price: 0,
    stock: 0,
    lowStockThreshold: 3,
  })
  const [inventoryAdjustment, setInventoryAdjustment] = useState({ productId: '', quantity: 0, note: '' })
  const [userForm, setUserForm] = useState({ id: '', username: '', password: '', role: 'CASHIER' as Role })

  const [cart, setCart] = useState<Record<string, number>>({})
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [cashReceived, setCashReceived] = useState(0)

  const apiFetch = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
        ...(options.headers ?? {}),
      },
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(payload?.message ?? 'Request failed')
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }, [token])

  const loadCoreData = useCallback(async () => {
    if (!token) {
      return
    }

    const [loadedProducts, loadedAlerts, loadedHistory, loadedTransactions, loadedDashboard] = await Promise.all([
      apiFetch<Product[]>('/products'),
      apiFetch<Product[]>('/inventory/alerts'),
      apiFetch<InventoryHistoryEntry[]>('/inventory/history'),
      apiFetch<Sale[]>('/sales/transactions'),
      apiFetch<DashboardOverview>('/dashboard/overview'),
    ])

    setProducts(loadedProducts)
    setLowStockProducts(loadedAlerts)
    setInventoryHistory(loadedHistory)
    setTransactions(loadedTransactions)
    setDashboard(loadedDashboard)
  }, [apiFetch, token])

  const loadReports = useCallback(async () => {
    if (!token) {
      return
    }

    const [sales, top, revenue, inventory] = await Promise.all([
      apiFetch<SalesReport>('/reports/sales?range=daily'),
      apiFetch<TopProduct[]>('/reports/top-products'),
      apiFetch<RevenuePoint[]>('/reports/revenue'),
      apiFetch<InventoryReport>('/reports/inventory'),
    ])

    setSalesReport(sales)
    setTopProducts(top)
    setRevenuePoints(revenue)
    setInventoryReport(inventory)
  }, [apiFetch, token])

  const loadUsers = useCallback(async () => {
    if (!token || !user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
      setUsers([])
      return
    }

    const loadedUsers = await apiFetch<User[]>('/users')
    setUsers(loadedUsers)
  }, [apiFetch, token, user])

  const refreshEverything = useCallback(async () => {
    await Promise.all([loadCoreData(), loadReports(), loadUsers()])
  }, [loadCoreData, loadReports, loadUsers])

  useEffect(() => {
    if (!token) {
      return
    }

    refreshEverything().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Failed to refresh data'
      setMessage(detail)
    })
  }, [refreshEverything, token])

  useEffect(() => {
    if (!token) {
      return
    }

    let isCancelled = false
    let fallbackInterval: number | null = null
    const abortController = new AbortController()
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null

    const startFallbackPolling = () => {
      if (fallbackInterval !== null) {
        return
      }
      fallbackInterval = window.setInterval(() => {
        refreshEverything().catch(() => undefined)
      }, 10000)
    }

    const connectStream = async () => {
      try {
        const response = await fetch(`${apiBase}/stream`, {
          headers: { 'x-auth-token': token },
          signal: abortController.signal,
        })
        if (!response.ok || !response.body) {
          startFallbackPolling()
          return
        }

        const decoder = new TextDecoder()
        const reader = response.body.getReader()
        streamReader = reader
        let buffer = ''

        while (!isCancelled) {
          const { value, done } = await reader.read()
          if (done) {
            startFallbackPolling()
            break
          }
          buffer += decoder.decode(value, { stream: true })

          let eventSeparator = buffer.indexOf('\n\n')
          while (eventSeparator >= 0) {
            const eventBlock = buffer.slice(0, eventSeparator)
            if (!eventBlock.includes('event: connected')) {
              refreshEverything().catch(() => undefined)
            }
            buffer = buffer.slice(eventSeparator + 2)
            eventSeparator = buffer.indexOf('\n\n')
          }
        }
      } catch {
        startFallbackPolling()
      }
    }

    connectStream().catch(() => startFallbackPolling())

    return () => {
      isCancelled = true
      abortController.abort()
      streamReader?.cancel().catch(() => undefined)
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval)
      }
    }
  }, [refreshEverything, token, user?.role])

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, quantity]) => {
          const product = productById.get(productId)
          if (!product || quantity <= 0) {
            return null
          }
          return {
            product,
            quantity,
            subtotal: Number((product.price * quantity).toFixed(2)),
          }
        })
        .filter((item): item is { product: Product; quantity: number; subtotal: number } => item !== null),
    [cart, productById],
  )

  const checkoutSubtotal = useMemo(
    () => Number(cartItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)),
    [cartItems],
  )
  const checkoutTax = Number((checkoutSubtotal * 0.1).toFixed(2))
  const checkoutTotal = Number((checkoutSubtotal + checkoutTax).toFixed(2))

  const canManageProducts = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const canViewUsers = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const canManageUsers = user?.role === 'ADMIN'
  const isErrorMessage = /failed|unable|invalid|insufficient|required|not found|too many/i.test(message)

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const response = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = (await response.json()) as { token?: string; user?: User; message?: string }
      if (!response.ok || !data.token || !data.user) {
        throw new Error(data.message ?? 'Login failed')
      }

      setToken(data.token)
      setUser(data.user)
      setActiveTab('DASHBOARD')
      setMessage('Logged in successfully.')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Login failed.'
      setMessage(detail)
    }
  }

  const clearProductForm = () => {
    setProductForm({ id: '', name: '', category: '', sku: '', price: 0, stock: 0, lowStockThreshold: 3 })
  }

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      if (productForm.id) {
        await apiFetch(`/products/${productForm.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...productForm, price: Number(productForm.price), stock: Number(productForm.stock) }),
        })
      } else {
        await apiFetch('/products', {
          method: 'POST',
          body: JSON.stringify({ ...productForm, price: Number(productForm.price), stock: Number(productForm.stock) }),
        })
      }
      clearProductForm()
      await refreshEverything()
      setMessage('Product saved.')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unable to save product.'
      setMessage(detail)
    }
  }

  const deleteProduct = async (id: string) => {
    try {
      await apiFetch(`/products/${id}`, { method: 'DELETE' })
      await refreshEverything()
      setMessage('Product deleted.')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unable to delete product.'
      setMessage(detail)
    }
  }

  const submitAdjustment = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await apiFetch('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          productId: inventoryAdjustment.productId,
          quantity: Number(inventoryAdjustment.quantity),
          note: inventoryAdjustment.note,
        }),
      })
      setInventoryAdjustment({ productId: '', quantity: 0, note: '' })
      await refreshEverything()
      setMessage('Inventory adjusted.')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unable to adjust inventory.'
      setMessage(detail)
    }
  }

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const payload = {
        username: userForm.username,
        role: userForm.role,
        ...(userForm.password ? { password: userForm.password } : {}),
      }

      if (userForm.id) {
        await apiFetch(`/users/${userForm.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await apiFetch('/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }

      setUserForm({ id: '', username: '', password: '', role: 'CASHIER' })
      await refreshEverything()
      setMessage('User saved.')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unable to save user.'
      setMessage(detail)
    }
  }

  const checkout = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!cartItems.length) {
      setMessage('Add at least one product to cart.')
      return
    }

    try {
      const response = await apiFetch<{ printableReceipt: string }>('/sales/checkout', {
        method: 'POST',
        body: JSON.stringify({
          items: cartItems.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
          paymentMethod,
          ...(paymentMethod === 'CASH' ? { cashReceived: Number(cashReceived) } : {}),
        }),
      })

      if (response.printableReceipt) {
        const printWindow = window.open('', '_blank', 'width=420,height=640')
        if (printWindow) {
          const receiptNode = printWindow.document.createElement('pre')
          receiptNode.textContent = response.printableReceipt
          printWindow.document.body.appendChild(receiptNode)
          printWindow.focus()
          printWindow.print()
        }
      }

      setCart({})
      setCashReceived(0)
      await refreshEverything()
      setMessage('Checkout completed and receipt generated.')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unable to complete checkout.'
      setMessage(detail)
    }
  }

  const clearSessionData = () => {
    setProducts([])
    setUsers([])
    setLowStockProducts([])
    setInventoryHistory([])
    setTransactions([])
    setDashboard(null)
    setSalesReport(null)
    setTopProducts([])
    setRevenuePoints([])
    setInventoryReport(null)
    setProductForm({ id: '', name: '', category: '', sku: '', price: 0, stock: 0, lowStockThreshold: 3 })
    setInventoryAdjustment({ productId: '', quantity: 0, note: '' })
    setUserForm({ id: '', username: '', password: '', role: 'CASHIER' })
    setCart({})
    setPaymentMethod('CASH')
    setCashReceived(0)
  }

  const visibleTabs = canViewUsers ? tabs : tabs.filter((tab) => tab !== 'USERS')

  if (!token || !user) {
    return (
      <main className="login-page">
        <form className="card form" onSubmit={handleLogin}>
          <h1>Web POS System</h1>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit">Sign In</button>
          {message && <p className={`message ${isErrorMessage ? 'error' : 'success'}`}>{message}</p>}
        </form>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="card topbar">
        <div>
          <h1>Web POS System</h1>
          <p>
            Signed in as <strong>{user.username}</strong> ({user.role})
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setToken('')
            setUser(null)
            clearSessionData()
            setActiveTab('DASHBOARD')
            setMessage('Signed out.')
          }}
        >
          Sign Out
        </button>
      </header>

      <nav className="tab-row">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {message && <p className={`message card ${isErrorMessage ? 'error' : 'success'}`}>{message}</p>}

      {activeTab === 'DASHBOARD' && dashboard && (
        <section className="grid">
          <article className="card">
            <h2>Sales Overview</h2>
            <p>Today's Sales: {formatCurrency(dashboard.todaySales)}</p>
            <p>Today's Transactions: {dashboard.todayTransactions}</p>
            <p>Total Revenue: {formatCurrency(dashboard.totalRevenue)}</p>
            <p>Total Transactions: {dashboard.totalTransactions}</p>
          </article>
          <article className="card">
            <h2>Inventory Status</h2>
            <p>Low Stock Products: {dashboard.lowStockCount}</p>
            <ul>
              {dashboard.inventoryStatus.map((item) => (
                <li key={item.id}>
                  {item.name} ({item.stock} left)
                </li>
              ))}
            </ul>
          </article>
          <article className="card span-two">
            <h2>Recent Transactions</h2>
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Cashier</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentTransactions.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.receiptNumber}</td>
                    <td>{sale.cashierName}</td>
                    <td>{sale.paymentMethod}</td>
                    <td>{formatCurrency(sale.total)}</td>
                    <td>{new Date(sale.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {activeTab === 'POS' && (
        <section className="grid">
          <article className="card span-two">
            <h2>Products</h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Add</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.category}</td>
                    <td>{product.sku}</td>
                    <td>{formatCurrency(product.price)}</td>
                    <td>{product.stock}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setCart((current) => ({
                            ...current,
                            [product.id]: Math.min(product.stock, (current[product.id] ?? 0) + 1),
                          }))
                        }}
                        disabled={product.stock === 0}
                      >
                        +
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
          <article className="card">
            <h2>Checkout</h2>
            <form className="form" onSubmit={checkout}>
              {cartItems.map((item) => (
                <div key={item.product.id} className="row">
                  <span>{item.product.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={item.product.stock}
                    value={item.quantity}
                    onChange={(event) => {
                      const quantity = Number(event.target.value)
                      setCart((current) => ({ ...current, [item.product.id]: quantity }))
                    }}
                  />
                  <strong>{formatCurrency(item.subtotal)}</strong>
                </div>
              ))}
              <div className="totals">
                <p>Subtotal: {formatCurrency(checkoutSubtotal)}</p>
                <p>Tax: {formatCurrency(checkoutTax)}</p>
                <p>Total: {formatCurrency(checkoutTotal)}</p>
              </div>
              <label>
                Payment Method
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="DIGITAL">Digital</option>
                </select>
              </label>
              {paymentMethod === 'CASH' && (
                <label>
                  Cash Received
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={cashReceived}
                    onChange={(event) => setCashReceived(Number(event.target.value))}
                  />
                </label>
              )}
              <button type="submit">Complete Sale</button>
            </form>
          </article>
        </section>
      )}

      {activeTab === 'PRODUCTS' && (
        <section className="grid">
          <article className="card">
            <h2>{productForm.id ? 'Edit Product' : 'Add Product'}</h2>
            <form className="form" onSubmit={saveProduct}>
              <label>
                Name
                <input
                  value={productForm.name}
                  onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                Category
                <input
                  value={productForm.category}
                  onChange={(event) => setProductForm((current) => ({ ...current, category: event.target.value }))}
                  required
                />
              </label>
              <label>
                SKU
                <input
                  value={productForm.sku}
                  onChange={(event) => setProductForm((current) => ({ ...current, sku: event.target.value }))}
                  required
                />
              </label>
              <label>
                Price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={productForm.price}
                  onChange={(event) => setProductForm((current) => ({ ...current, price: Number(event.target.value) }))}
                  required
                />
              </label>
              <label>
                Stock
                <input
                  type="number"
                  min={0}
                  value={productForm.stock}
                  onChange={(event) => setProductForm((current) => ({ ...current, stock: Number(event.target.value) }))}
                  required
                />
              </label>
              <label>
                Low Stock Threshold
                <input
                  type="number"
                  min={0}
                  value={productForm.lowStockThreshold}
                  onChange={(event) =>
                    setProductForm((current) => ({ ...current, lowStockThreshold: Number(event.target.value) }))
                  }
                  required
                />
              </label>
              <div className="button-row">
                <button type="submit" disabled={!canManageProducts}>
                  Save Product
                </button>
                {productForm.id && (
                  <button type="button" onClick={clearProductForm}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </article>
          <article className="card span-two">
            <h2>Product List</h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.category}</td>
                    <td>{product.sku}</td>
                    <td>{formatCurrency(product.price)}</td>
                    <td>{product.stock}</td>
                    <td>
                      <div className="button-row">
                        <button type="button" onClick={() => setProductForm(product)} disabled={!canManageProducts}>
                          Edit
                        </button>
                        <button type="button" onClick={() => deleteProduct(product.id)} disabled={!canManageProducts}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {activeTab === 'INVENTORY' && (
        <section className="grid">
          <article className="card">
            <h2>Inventory Adjustment</h2>
            <form className="form" onSubmit={submitAdjustment}>
              <label>
                Product
                <select
                  value={inventoryAdjustment.productId}
                  onChange={(event) =>
                    setInventoryAdjustment((current) => ({ ...current, productId: event.target.value }))
                  }
                  required
                >
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.stock} in stock)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity (+/-)
                <input
                  type="number"
                  value={inventoryAdjustment.quantity}
                  onChange={(event) =>
                    setInventoryAdjustment((current) => ({ ...current, quantity: Number(event.target.value) }))
                  }
                  required
                />
              </label>
              <label>
                Note
                <input
                  value={inventoryAdjustment.note}
                  onChange={(event) => setInventoryAdjustment((current) => ({ ...current, note: event.target.value }))}
                  required
                />
              </label>
              <button type="submit" disabled={!canManageProducts}>
                Submit Adjustment
              </button>
            </form>
            <h3>Low Stock Alerts</h3>
            <ul>
              {lowStockProducts.map((product) => (
                <li key={product.id}>
                  {product.name} ({product.stock}/{product.lowStockThreshold})
                </li>
              ))}
            </ul>
          </article>
          <article className="card span-two">
            <h2>Stock History</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Change</th>
                  <th>Previous</th>
                  <th>New</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {inventoryHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{productById.get(entry.productId)?.name ?? entry.productId}</td>
                    <td>{entry.type}</td>
                    <td>{entry.quantity}</td>
                    <td>{entry.previousStock}</td>
                    <td>{entry.newStock}</td>
                    <td>{entry.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {activeTab === 'REPORTS' && (
        <section className="grid">
          <article className="card">
            <h2>Sales Report (Daily)</h2>
            {salesReport && (
              <>
                <p>Transactions: {salesReport.transactionCount}</p>
                <p>Total Revenue: {formatCurrency(salesReport.totalRevenue)}</p>
                <p>Average Order Value: {formatCurrency(salesReport.averageOrderValue)}</p>
              </>
            )}
          </article>
          <article className="card">
            <h2>Inventory Report</h2>
            {inventoryReport && (
              <>
                <p>Total Products: {inventoryReport.totalProducts}</p>
                <p>Total Stock Units: {inventoryReport.totalStock}</p>
                <p>Stock Value: {formatCurrency(inventoryReport.stockValue)}</p>
                <p>Low Stock Products: {inventoryReport.lowStockCount}</p>
              </>
            )}
          </article>
          <article className="card span-two">
            <h2>Top-Selling Products</h2>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Quantity Sold</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product) => (
                  <tr key={product.productId}>
                    <td>{product.name}</td>
                    <td>{product.sku}</td>
                    <td>{product.quantity}</td>
                    <td>{formatCurrency(product.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
          <article className="card span-two">
            <h2>Revenue by Day</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Revenue</th>
                  <th>Transactions</th>
                </tr>
              </thead>
              <tbody>
                {revenuePoints.map((point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td>{formatCurrency(point.revenue)}</td>
                    <td>{point.transactions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
          <article className="card span-two">
            <h2>Transaction History</h2>
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Cashier</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.receiptNumber}</td>
                    <td>{transaction.cashierName}</td>
                    <td>{transaction.paymentMethod}</td>
                    <td>{formatCurrency(transaction.total)}</td>
                    <td>{new Date(transaction.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {activeTab === 'USERS' && canViewUsers && (
        <section className="grid">
          {canManageUsers && (
            <article className="card">
              <h2>{userForm.id ? 'Edit User' : 'Create User'}</h2>
              <form className="form" onSubmit={saveUser}>
                <label>
                  Username
                  <input
                    value={userForm.username}
                    onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder={userForm.id ? 'Leave blank to keep current password' : ''}
                  />
                </label>
                <label>
                  Role
                  <select
                    value={userForm.role}
                    onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value as Role }))}
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="MANAGER">Manager</option>
                    <option value="CASHIER">Cashier</option>
                  </select>
                </label>
                <div className="button-row">
                  <button type="submit">Save User</button>
                  {userForm.id && (
                    <button type="button" onClick={() => setUserForm({ id: '', username: '', password: '', role: 'CASHIER' })}>
                      Cancel Edit
                    </button>
                  )}
                </div>
              </form>
            </article>
          )}
          <article className="card span-two">
            <h2>Employee Accounts</h2>
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((existingUser) => (
                  <tr key={existingUser.id}>
                    <td>{existingUser.username}</td>
                    <td>{existingUser.role}</td>
                    <td>
                      {canManageUsers ? (
                        <button
                          type="button"
                          onClick={() =>
                            setUserForm({
                              id: existingUser.id,
                              username: existingUser.username,
                              password: '',
                              role: existingUser.role,
                            })
                          }
                        >
                          Edit
                        </button>
                      ) : (
                        'View only'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}
    </main>
  )
}

export default App
