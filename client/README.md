# Web POS Frontend

React + TypeScript + Vite client for the Web POS system.

## Development

From repository root:

```bash
NODE_ENV=development npm run dev
```

Frontend runs on `http://localhost:5173` and proxies API requests to backend `http://localhost:4000`.

## Production Build

```bash
npm run build
```

## Notes

- Uses token-based authentication (`x-auth-token` header)
- Includes dashboard, POS checkout, product/inventory management, reports, and user management UI
- Supports print-friendly receipt output from checkout flow
