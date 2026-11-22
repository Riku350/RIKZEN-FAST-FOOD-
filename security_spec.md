# RikZen Fast Food — Firestore Security Specification (Phase 0)

## 1. Data Invariants

1. **Owner Privilege Isolation**: Only verified owner/admin accounts (`request.auth.token.email_verified == true` matching the bootstrapped owner email or `/admins/{uid}`) may list orders, list all tables, mutate menu items, accept/reject/prepare/complete orders, or read other users' profiles.
2. **Table Allowlist Integrity**: Orders may only reference one of the 6 physical restaurant tables (`table_1`..`table_6`, `table_number` 1..6).
3. **Server-Verified Order Pricing**: Every order submitted must contain a valid `server_signature` computed by `/api/orders/verify`, positive integer/numeric `subtotal == total`, valid bounded `items` (1..20 items), and `created_at == request.time`.
4. **Customer Order Isolation**: Customers can NEVER list `/orders` (`allow list: if isAdmin()`). Customers can only subscribe to their exact unguessable `orderId` (length >= 24) and may only transition their own order from `accepted`/`preparing`/`ready` to `bill_requested`.
5. **Terminal State Locking**: Once an order reaches `completed` or `rejected`, non-admin clients cannot modify it further.
6. **Immutability**: Order `id`, `order_number`, `table_id`, `table_number`, `items`, `item_count`, `subtotal`, `total`, `customer_session_id`, `server_signature`, and `created_at` are strictly immutable after creation.
7. **PII Isolation**: `/users/{userId}` contains email addresses and is strictly restricted to `isOwner(userId) || isAdmin()`; blanket reads are prohibited.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Collection | Malicious Payload / Action | Expected Result |
|---|---------------|-------------------|----------------------------|-----------------|
| 1 | **Shadow Field Injection** | `/orders/{orderId}` | Create order with extra ghost field `isFree: true` | `PERMISSION_DENIED` |
| 2 | **Order Scraping / List Leak** | `/orders` | Unauthenticated or non-admin `list` query on `/orders` | `PERMISSION_DENIED` |
| 3 | **State Shortcutting on Create** | `/orders/{orderId}` | Create order directly with `status: "accepted"` or `"completed"` | `PERMISSION_DENIED` |
| 4 | **Customer Self-Acceptance** | `/orders/{orderId}` | Customer attempts `update` changing `status` from `pending` to `accepted` | `PERMISSION_DENIED` |
| 5 | **Price Tampering on Update** | `/orders/{orderId}` | Customer attempts `update` setting `total: 1` alongside `status: "bill_requested"` | `PERMISSION_DENIED` |
| 6 | **Terminal State Mutation** | `/orders/{orderId}` | Customer attempts `update` on an order with `status: "completed"` | `PERMISSION_DENIED` |
| 7 | **Invalid Table Spoofing** | `/orders/{orderId}` | Create order with `table_id: "table_99"`, `table_number: 99` | `PERMISSION_DENIED` |
| 8 | **ID Poisoning / DoW** | `/orders/{1500-char-id}` | Create order with 1.5KB junk document ID or short guessable ID `"123"` | `PERMISSION_DENIED` |
| 9 | **Email Spoofing Attack** | `/orders` (list) | Request with `token.email == ownerEmail` but `token.email_verified == false` | `PERMISSION_DENIED` |
| 10 | **PII Blanket Read** | `/users/{otherUid}` | Non-admin authenticated user tries `get` on another user's profile | `PERMISSION_DENIED` |
| 11 | **Privilege Escalation** | `/users/{uid}` | Non-admin user tries to create/update own profile with `role: "owner"` | `PERMISSION_DENIED` |
| 12 | **Unauthorized Menu Tampering** | `/menu_items/chicken_roll` | Unauthenticated or non-admin client tries to update `price: 1` | `PERMISSION_DENIED` |
