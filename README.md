# Web POS System

A full-stack web-based Point of Sale (POS) system with product, sales, inventory, reporting, user management, and dashboard features.

## Features

- **Product Management**: add/edit/delete products, categories, SKU, pricing, stock levels
- **Sales / Checkout**: cart management, quantity updates, real-time totals, cash/card/digital payments, printable receipts
- **Inventory Management**: stock tracking, low-stock alerts, manual adjustments, stock history
- **Reporting & Analytics**: daily/weekly/monthly sales summaries, top-selling products, revenue trend, transaction history, inventory report
- **User Management**: login, employee accounts, role-based access (Admin/Manager/Cashier), activity logs
- **Dashboard**: sales KPIs, recent transactions, low-stock inventory status
- **Real-time updates** via Server-Sent Events (SSE)
- **Responsive UI** for desktop and mobile

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Persistence**: JSON database via LowDB (`server/data/db.json`)
- **Authentication**: JWT-based auth tokens

## Getting Started

### 1) Install dependencies

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 2) Run in development

```bash
NODE_ENV=development npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

### 3) Build

```bash
npm run build
```

## Authentication Setup

- In `NODE_ENV=development`, the server seeds a default admin account:
  - **Username**: `admin`
  - **Password**: `admin123` (or `DEFAULT_ADMIN_PASSWORD` if provided)
- In non-development environments, you **must** set:
  - `JWT_SECRET`
  - `DEFAULT_ADMIN_PASSWORD`

## Role Permissions

- **Admin**: full access (users/products/inventory/reports/sales/dashboard)
- **Manager**: products/inventory/reports/sales/dashboard
- **Cashier**: sales/checkout, products view, reports/dashboard view

## API Overview

- Auth: `/api/auth/login`, `/api/auth/me`
- Users: `/api/users`
- Products: `/api/products`
- Inventory: `/api/inventory/alerts`, `/api/inventory/history`, `/api/inventory/adjustments`
- Sales: `/api/sales/checkout`, `/api/sales/transactions`
- Reports: `/api/reports/sales`, `/api/reports/top-products`, `/api/reports/revenue`, `/api/reports/inventory`
- Dashboard: `/api/dashboard/overview`
- Activity logs: `/api/activity-logs`
- Stream: `/api/stream`

## Notes

- Data is persisted to `server/data/db.json`.
- Set `JWT_SECRET` and `DEFAULT_ADMIN_PASSWORD` in non-development deployments.
