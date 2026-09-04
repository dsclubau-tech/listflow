# Automation Alchemists Entitlement Handover Review & Integration Specification

**Date:** September 4, 2026  
**Status:** Completed Handover Verified  
**Target Systems:** ListFlow Control Plane (Next.js / Vercel), Execution Plane (Railway Workers), Automation Alchemists (AA Supabase)

---

## 1. Executive Summary

Automation Alchemists (AA) has delivered the final handover details for the scoped machine-to-server entitlement check endpoint. This handover fulfills all remaining requirements specified in [AA_ENTITLEMENT_CONTRACT_CONFIRMATION.md](file:///d:/listflow/AA_ENTITLEMENT_CONTRACT_CONFIRMATION.md#L116-L128).

The delivered contract adheres strictly to ListFlow's design recommendations:
- **Server-to-server scoped Bearer authentication** (no customer refresh tokens stored in workers).
- **15-minute polling interval** coordinated across Railway workers.
- **Strict invariant mapping:**
  - `active` $\rightarrow$ `count > 0` (number of allowed eBay store slots).
  - `inactive` $\rightarrow$ `count = 0` (confirmed zero; paid operations blocked).
  - `unavailable` $\rightarrow$ `count` omitted (temporary outage; never interpreted as cancellation).
- **5-second request timeout** with 1 jittered retry on network failure/429/5xx.
- **Permanent identity key:** Immutable AA Supabase User UUID (Gmail accounts only).

---

## 2. Connection Details & Credential Separation

| Configuration Item | Value / Description | Scope & Placement |
| :--- | :--- | :--- |
| **AA Supabase Project URL** | `https://tdevgrwmafwrsmeymjzd.supabase.co` | Browser Client & Server (`NEXT_PUBLIC_AA_SUPABASE_URL`) |
| **AA Supabase Anon/Publishable Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Browser Client (`NEXT_PUBLIC_AA_SUPABASE_ANON_KEY`) |
| **Entitlement Check Endpoint** | `https://tdevgrwmafwrsmeymjzd.supabase.co/functions/v1/entitlement-check` | Server & Railway Workers (`AA_ENTITLEMENT_CHECK_URL`) |
| **Product Slug** | `"listflow"` | Request payload (`AA_PRODUCT_SLUG`) |
| **Credential ID** | `a515700f-dceb-41f2-b673-8a621e4370fe` | Administrative / Secret Manager Reference |
| **Key Prefix** | `aa_live_listflow...7BeE` | Audit / Identification prefix |
| **Machine Bearer Token** | Stored in secure vault (`AA_ENTITLEMENT_BEARER_TOKEN`) | **Secret:** Server & Railway Worker environments ONLY |

> [!WARNING]
> **Secret Handling Rules for Machine Token**
> - **Never** prefix the machine token with `NEXT_PUBLIC_`.
> - **Never** expose the token to the client bundle or browser.
> - **Never** commit the raw machine token to version control or public documentation.
> - Redact the `Authorization` header from all application and worker logs.

---

## 3. Wire Contract Specification

### 3.1 Request Format

```http
POST https://tdevgrwmafwrsmeymjzd.supabase.co/functions/v1/entitlement-check
Authorization: Bearer <AA_ENTITLEMENT_BEARER_TOKEN>
Content-Type: application/json
```

```json
{
  "user_id": "<AA Supabase user UUID>",
  "product_slug": "listflow"
}
```

### 3.2 Response Matrix & State Handling

| Status Code | Response Body Pattern | Meaning | ListFlow Operational Action |
| :--- | :--- | :--- | :--- |
| **`200 OK`** | `{"status": "active", "count": 1, ...}` | Customer has paid grant. `count` = allowed eBay store slots. | Allow background syncs and worker jobs. Enforce $\text{connected stores} \le \text{count}$. Cache result for 15 minutes. |
| **`200 OK`** | `{"status": "inactive", "count": 0, ...}` | Subscription inactive / manual grant removed. | Fail-closed: block background processing and active syncs. Do not immediately retry; wait for next 15-minute scheduled poll. |
| **`404 Not Found`** | `{"error": "user_not_found"}` | User UUID not recognized in AA system. | Treat as inactive / unregistered. Advise user to register via main AA portal. |
| **`503 Service Unavailable`** | `{"status": "unavailable"}` *(count omitted)* | AA service or database is temporarily unreachable. | **Do NOT treat as cancellation.** Preserve queued jobs, pause execution, and retry with exponential backoff. |
| **`429 Too Many Requests`** | `{"error": "Rate limit exceeded"}` *(Header: `Retry-After: 60`)* | Rate limit hit (limit is 100 req/min). | Pause calls to AA for 60 seconds (or duration specified in header). |
| **`401 / 403`** | `{"error": "Unauthorized"}` | Machine token is invalid, missing, or revoked. | Emit high-severity admin alert immediately. Do not loop retries. |

---

## 4. Operational Invariants & Policies

```text
┌─────────────────────────────────────────────────────────────┐
│                    Railway Worker Loop                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                Check local DB Entitlement Cache
                               │
            ┌──────────────────┴──────────────────┐
     Cache Fresh (<15m)                    Cache Stale (>15m)
            │                                     │
            ▼                                     ▼
Execute / Skip Job by Status             Call AA Entitlement Check
                                                  │
                                   ┌──────────────┴──────────────┐
                            Status: ACTIVE                Status: UNAVAILABLE
                                   │                             │
                                   ▼                             ▼
                            Allow Work (count)            Keep Jobs Queued
```

1. **Staleness Lease (15 Minutes):** Each customer's entitlement snapshot is valid for 15 minutes. Refreshes must be coordinated through the shared database so multiple workers do not trigger concurrent requests for the same customer.
2. **Quota & Rate Limits:** 100 requests/minute per machine credential allows for over 1,500 active customers on standard 15-minute polling without hitting limits.
3. **Fail-Closed vs. Fail-Safe:**
   - Interactive operations attempting to add new eBay stores fail closed if `active` status is not confirmed.
   - Background queued jobs fail-safe during `unavailable` (503) by postponing execution rather than terminating or failing the job permanently.

---

## 5. ListFlow Implementation Checklist

### Phase 1: Environment Variables
Configure the following in local `.env`, Vercel (Production/Preview), and Railway:
- `NEXT_PUBLIC_AA_SUPABASE_URL`
- `NEXT_PUBLIC_AA_SUPABASE_ANON_KEY`
- `AA_ENTITLEMENT_CHECK_URL`
- `AA_ENTITLEMENT_BEARER_TOKEN`
- `AA_PRODUCT_SLUG="listflow"`

### Phase 2: Database Schema Additions ([prisma/schema.prisma](file:///d:/listflow/prisma/schema.prisma))
- Add `aaUserId` (UUID) mapping to customer accounts / stores.
- Create an `EntitlementSnapshot` model:
  ```prisma
  model EntitlementSnapshot {
    userId        String   @id // AA Supabase User UUID
    status        String   // ACTIVE, INACTIVE, UNAVAILABLE
    allowedStores Int      @default(0)
    lastCheckedAt DateTime @default(now())
    checkedAt     DateTime?
    updatedAt     DateTime @updatedAt

    @@index([lastCheckedAt])
  }
  ```

### Phase 3: Entitlement Service Module (`lib/aa-entitlement.ts`)
- Implement `fetchEntitlement(userId: string)`:
  - Strict 5,000ms timeout (`AbortSignal.timeout(5000)`).
  - 1 jittered retry on network failure or 5xx/429.
  - Safe parsing ensuring `unavailable` never sets `allowedStores` to 0.
- Implement database caching and deduplication to prevent worker stampedes.

### Phase 4: Worker & Store Limit Integration
- **Worker Pre-Claim Check:** In `scripts/listflow-worker.ts`, verify that the store owner's entitlement snapshot is `ACTIVE` before leasing jobs.
- **Store Creation Guard:** Enforce $\text{Count}(\text{Active Stores}) < \text{Allowed Stores}$ in API routes before authorizing new eBay store connections.
