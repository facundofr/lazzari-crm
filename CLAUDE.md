# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lazzari Soluciones Industriales — CRM/management system for an industrial solutions company (valves, pipes, industrial equipment) based in Argentina.

## Commands

All commands run from `crm/app/`:

```bash
cd crm/app
npm run dev      # Dev server (Next.js on localhost:3000)
npm run build    # Production build (ESLint errors ignored via next.config.ts)
npm run lint     # ESLint
```

No test framework is configured yet.

## Architecture

### CRM App (`crm/app/`)

- **Framework:** Next.js 15 (App Router) + React 18 + TypeScript + Tailwind CSS 4
- **Backend:** Supabase (Auth, Postgres, Storage, Realtime, Edge Functions)
- **Deployment:** Vercel (root directory: `crm/app`)
- **Key deps:** Recharts (charts), Lucide React (icons), date-fns, @anthropic-ai/sdk (AI widget)
- **UI utilities:** clsx, tailwind-merge, class-variance-authority (CVA)

### Key Directories

```
crm/app/src/
  app/(crm)/              # Route group — 11 CRM modules behind auth
  app/api/ai/             # AI agent API route (Claude + Supabase tool use)
  app/api/parse-lista-precios/ # PDF price list parser
  components/layout/      # Sidebar, Header, AIWidget
  components/ui/          # Badge, Card, StatCard, DataTable, SmartFilters, Modal, Toast, Input, EmptyState
  lib/supabase/queries/   # Data access layer — one file per module
  lib/auth-context.tsx    # UserProvider context (profile, role, sidebar state)
  lib/theme-context.tsx   # ThemeProvider for dark/light mode toggle
  lib/types.ts            # TypeScript interfaces, Role type, ROLE_PERMISSIONS map
  lib/mock-data.ts        # Fallback mock data used when Supabase queries fail
  lib/utils.ts            # cn(), formatCurrency(), formatDate(), formatDateTime(), getInitials()
```

### CRM Modules (routes under `app/(crm)/`)

dashboard, clientes, proveedores, presupuestos, ordenes-compra, stock, facturacion, remitos, finanzas, reportes, configuracion

### Auth & Session Flow

1. Middleware (`src/middleware.ts` → `lib/supabase/middleware.ts`) checks session on every request via `supabase.auth.getUser()`
2. Unauthenticated → `/login`; authenticated on `/login` → `/dashboard`
3. `(crm)/layout.tsx` wraps all CRM pages in `<UserProvider>` which fetches profile from `profiles` table
4. **Server components:** use `createSupabaseServer()` from `lib/supabase/server.ts` (async, reads cookies)
5. **Client components:** use the singleton `supabase` from `lib/supabase/client.ts` (browser client)
6. **Query files** (`lib/supabase/queries/*`) currently use the browser client directly — they run client-side

### Data Fetching Pattern

All pages use a **hybrid fallback approach**: attempt Supabase query → fall back to mock data on error. Some pages (like presupuestos) have progressive degradation: try with joins → try without joins → try minimal select → mock. When adding new features, maintain this pattern.

Each page defines its own `*Row` interface for the raw Supabase response and a `mapTo*()` function to convert snake_case DB rows to camelCase TypeScript interfaces. Example from clientes:

```
interface ClienteRow { id: string; razon_social: string; ... }  // raw DB shape
function mapToClient(row: ClienteRow): Client { ... }            // defined in the page file
```

### AI Agent (`api/ai/route.ts`)

Server-side API route that uses Claude with Supabase tool use. The AI can run SELECT/INSERT/UPDATE queries against the database, with role-based write permissions enforced via `TABLE_ACCESS` and `ROLE_HIERARCHY` maps. The floating `AIWidget` component (`components/layout/ai-widget.tsx`) provides the chat UI.

### Role System

Five roles defined in `lib/types.ts`: `super_admin`, `admin`, `vendedor`, `administrativo`, `viewer`. Permissions enforced client-side via `ROLE_PERMISSIONS` map and server-side via Supabase RLS policies on `profiles.role`.

### Database

Supabase project ID: `ycuzszzskqatlegtbgbq`. Full schema plan in `SUPABASE_PLAN.md` (27 tables across 9 layers). Key design decisions:

- `profiles` table linked to `auth.users` via trigger (no custom users table)
- Prices frozen at presupuesto creation time (not FK references)
- Auto-numbering via PG function `generate_document_number()` (e.g., `PR-2026-0049`)
- RLS enabled on all tables; role-based access from `profiles`
- Some FK joins (e.g., `created_by`) may be null — avoid inner joins on nullable FKs
- Polymorphic contacts table: `contactos` with `entity_type` (cliente/proveedor) and `entity_id`

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anonymous key
ANTHROPIC_API_KEY             # Server-side only, used by api/ai route
```

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

## Conventions

- **Language:** All UI text, labels, and user-facing content in Spanish (Argentina)
- **Styling:** Tailwind utility classes; dark mode supported via `dark:` prefix and `ThemeProvider`
- **Color palette:** Orange `#FF4500` (primary), zinc scale for neutrals
- **Components:** CVA for variant-based component styling (see `badge.tsx`, `card.tsx`)
- **Data queries:** One file per module in `lib/supabase/queries/`, using the Supabase JS client. Pattern: query, throw on error, return data.
- **Page structure:** Each page is `"use client"`, fetches data in `useEffect`, maps DB rows to TS interfaces, renders with `DataTable` + detail side panel
- **Currency:** Dual currency support (USD/ARS) throughout. `formatCurrency()` from `lib/utils.ts`
- **Dates:** `formatDate()` / `formatDateTime()` from `lib/utils.ts` using `Intl.DateTimeFormat("es-AR")`
- **Next.js version warning:** This is Next.js 15 — APIs may differ from training data. Read docs in `node_modules/next/dist/docs/` before using new APIs (see `crm/app/AGENTS.md`).

## Key Files

- `SUPABASE_PLAN.md` — Complete database schema, RLS policies, triggers, views, indexes, and migration plan
- `PROJECT.md` — Full project scope, modules, and timeline
- `crm/app/src/lib/types.ts` — All roles, permissions, and TypeScript interfaces
- `crm/app/src/lib/auth-context.tsx` — User/profile context provider used by all CRM pages
- `crm/app/src/lib/mock-data.ts` — Comprehensive mock dataset (5 clients, 8 products, 6 suppliers, etc.)
- `crm/app/src/components/ui/data-table.tsx` — Generic sortable/paginated table used by all pages
- `crm/app/src/components/ui/smart-filters.tsx` — Reusable filter bar (select, date-range, number-range)
- `crm/app/src/app/api/ai/route.ts` — AI agent with Claude tool use + Supabase DB access
- `crm/app/AGENTS.md` — Next.js 15 warning: read `node_modules/next/dist/docs/` before using new APIs
