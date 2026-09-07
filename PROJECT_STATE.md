# ListFlow Project State

**Last Updated:** September 7, 2026

## 1. Overview
ListFlow is an internal eBay listing and inventory management tool for multi-store e-commerce operations. It handles product scraping (e.g. Amazon to eBay), pricing algorithms, automatic price checks, and bulk operations across multiple eBay stores.

## 2. Architecture & Tech Stack
- **Framework:** Next.js 16 (App Router, Turbopack, React 19)
- **Database:** PostgreSQL hosted on Supabase (pooled connections via PgBouncer, migration target `tdevgrwmafwrsmeymjzd`)
- **ORM:** Prisma 7 with `@prisma/adapter-pg`
- **Authentication:** Dual-mode authentication:
  1. Automation Alchemists (AA) Supabase Auth (`@supabase/ssr`) with entitlement checks via `getOrRefreshEntitlement`.
  2. Legacy NextAuth credentials provider (`auth.ts`, `auth.config.ts`) using bcrypt hashed store passwords.
- **Entitlement & Store Session:**
  - `lib/aa-entitlement.ts`: Checks active grants with Automation Alchemists, enforces cache TTL, and gates access at `/subscription-required`.
  - `lib/store-session.ts`: Resolves active store session (`getCurrentStoreSession`), ranks stores by `createdAt ASC`, and honors active store selection via the `listflow_active_store_id` cookie.
- **UI & Design System:**
  - Vanilla Tailwind CSS with custom palette: Primary (`#0a2540`), Secondary (`#20c997`), Tertiary/Mint/Teal accents.
  - Interactive modals: `StoreSwitcherModal` for multi-store account management modeled on Chrome's profile picker.

## 3. Store Management & Switching
- Users with multiple entitled stores (`isEntitled: true`) can switch their active workspace via the store switcher modal.
- Active store ID is persisted in the `listflow_active_store_id` cookie (1-year TTL).
- Inactive stores (e.g. `isActive: false` test stores) are excluded from the picker.
- "Add Store" card directs users to support to allocate additional store slots.
