# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lazzari Soluciones Industriales — three integrated components: institutional website (`web/`), visual identity (`diseno/`), and CRM/management system (`crm/`). The CRM is the core deliverable (USD 3,500).

**Client:** Industrial solutions company (valves, pipes, industrial equipment) based in Argentina.

## Commands

All commands run from `crm/app/`:

```bash
cd crm/app
npm run dev      # Dev server (Next.js on localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

No test framework is configured yet.

## Architecture

### CRM App (`crm/app/`)

- **Framework:** Next.js 15 (App Router) + React 18 + TypeScript + Tailwind CSS 4
- **Backend:** Supabase (Auth, Postgres, Storage, Realtime, Edge Functions)
- **Deployment:** Vercel (root directory: `crm/app`)
- **Charts:** Recharts
- **Icons:** Lucide React
- **UI utilities:** clsx, tailwind-merge, class-variance-authority (CVA)

### Directory Structure

```
crm/app/src/
  app/
    layout.tsx              # Root layout (lang="es")
    page.tsx                # Root redirect
    login/page.tsx          # Auth page (email+password via Supabase)
    (crm)/                  # Route group — all CRM pages behind auth
      layout.tsx            # Sidebar + AIWidget wrapper
      dashboard/page.tsx
      clientes/page.tsx
      presupuestos/page.tsx
      facturacion/page.tsx
      remitos/page.tsx
      stock/page.tsx
      finanzas/page.tsx
      proveedores/page.tsx
      ordenes-compra/page.tsx
      reportes/page.tsx
      configuracion/page.tsx
  components/
    layout/                 # Sidebar, Header, AIWidget
    ui/                     # Reusable: Badge, Card, StatCard, DataTable
  lib/
    types.ts                # All TypeScript interfaces and role permissions
    mock-data.ts            # Mock data (being replaced by Supabase queries)
    utils.ts                # cn() helper (clsx + tailwind-merge)
    supabase/
      client.ts             # Browser client (createClient)
      server.ts             # Server Component client (createServerClient + cookies)
      middleware.ts          # Auth session refresh + route protection
      database.types.ts     # Auto-generated Supabase types
      queries/              # Data access layer per module
  middleware.ts             # Next.js middleware entry — delegates to supabase/middleware
```

### Auth Flow

1. Supabase Auth with email+password (invite-only planned)
2. Middleware (`src/middleware.ts`) checks session on every request
3. Unauthenticated users redirect to `/login`; authenticated users on `/login` redirect to `/dashboard`
4. Server components use `createSupabaseServer()` from `lib/supabase/server.ts`
5. Client components use `createBrowserClient()` from `@supabase/ssr`

### Role System

Five roles defined in `lib/types.ts`: `super_admin`, `admin`, `vendedor`, `administrativo`, `viewer`. Permissions are enforced both client-side (via `ROLE_PERMISSIONS` map) and server-side (via Supabase RLS policies on the `profiles.role` column).

### Database

Supabase project ID: `ycuzszzskqatlegtbgbq`. Full schema plan in `SUPABASE_PLAN.md` (27 tables across 9 layers). Key design decisions:

- `profiles` table linked to `auth.users` via trigger (no custom users table)
- Prices frozen at presupuesto creation time (not FK references)
- Auto-numbering via PG function `generate_document_number()` (e.g., `PR-2026-0049`)
- RLS enabled on all tables; role-based access from `profiles`

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

## Conventions

- **Language:** All UI text, labels, and user-facing content in Spanish (Argentina)
- **Styling:** Tailwind utility classes; dark mode supported via `dark:` prefix
- **Color palette:** Orange `#FF4500` (primary), zinc scale for neutrals
- **Components:** CVA for variant-based component styling (see `badge.tsx`, `card.tsx`)
- **Data queries:** One file per module in `lib/supabase/queries/`, using the Supabase JS client
- **Currency:** Dual currency support (USD/ARS) throughout

## Key Files

- `SUPABASE_PLAN.md` — Complete database schema, RLS policies, triggers, views, indexes, and migration plan
- `PROJECT.md` — Full project scope, modules, and timeline
- `crm/app/AGENTS.md` — Next.js version warning (read docs in `node_modules/next/dist/docs/` before using new APIs)
