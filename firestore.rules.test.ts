/**
 * Phase 0: Security Rules Verification Specification for RikZen Fast Food.
 * Verifies all 12 "Dirty Dozen" adversarial payloads against firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  actor: 'customer' | 'unverified_owner' | 'non_admin_user' | 'owner';
  payload: Record<string, unknown>;
  expected: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on Order Create',
    collection: 'orders/ord_a1b2c3d4e5f6g7h8i9j0k1l2',
    operation: 'create',
    actor: 'customer',
    payload: {
      id: 'ord_a1b2c3d4e5f6g7h8i9j0k1l2',
      order_number: 1024,
      table_id: 'table_3',
      table_number: 3,
      items: [{ menu_item_id: 'chicken_roll', name: 'Chicken Roll', unit_price: 80, quantity: 1, line_total: 80 }],
      item_count: 1,
      subtotal: 80,
      total: 80,
      status: 'pending',
      customer_session_id: 'sess_1234567890abcdef',
      server_signature: 'a'.repeat(64),
      notes: '',
      isFree: true, // Ghost field
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Customer List Query Scraping All Orders',
    collection: 'orders',
    operation: 'list',
    actor: 'customer',
    payload: {},
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'State Shortcutting on Order Create',
    collection: 'orders/ord_a1b2c3d4e5f6g7h8i9j0k1l3',
    operation: 'create',
    actor: 'customer',
    payload: {
      id: 'ord_a1b2c3d4e5f6g7h8i9j0k1l3',
      order_number: 1025,
      table_id: 'table_3',
      table_number: 3,
      items: [{ menu_item_id: 'chicken_roll', name: 'Chicken Roll', unit_price: 80, quantity: 1, line_total: 80 }],
      item_count: 1,
      subtotal: 80,
      total: 80,
      status: 'accepted', // Must start at pending
      customer_session_id: 'sess_1234567890abcdef',
      server_signature: 'a'.repeat(64),
      notes: '',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Customer Self-Acceptance Update',
    collection: 'orders/ord_a1b2c3d4e5f6g7h8i9j0k1l2',
    operation: 'update',
    actor: 'customer',
    payload: { status: 'accepted' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Price Tampering During Bill Request',
    collection: 'orders/ord_a1b2c3d4e5f6g7h8i9j0k1l2',
    operation: 'update',
    actor: 'customer',
    payload: { status: 'bill_requested', total: 1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Terminal State Mutation After Completion',
    collection: 'orders/ord_completed_1234567890abcd',
    operation: 'update',
    actor: 'customer',
    payload: { status: 'bill_requested' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid Table Number Spoofing',
    collection: 'orders/ord_a1b2c3d4e5f6g7h8i9j0k1l4',
    operation: 'create',
    actor: 'customer',
    payload: {
      id: 'ord_a1b2c3d4e5f6g7h8i9j0k1l4',
      order_number: 1026,
      table_id: 'table_99',
      table_number: 99,
      items: [{ menu_item_id: 'chicken_roll', name: 'Chicken Roll', unit_price: 80, quantity: 1, line_total: 80 }],
      item_count: 1,
      subtotal: 80,
      total: 80,
      status: 'pending',
      customer_session_id: 'sess_1234567890abcdef',
      server_signature: 'a'.repeat(64),
      notes: '',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID Poisoning / Short Guessable Order ID',
    collection: 'orders/123',
    operation: 'create',
    actor: 'customer',
    payload: { id: '123' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Unverified Owner Email Spoof Attack',
    collection: 'orders',
    operation: 'list',
    actor: 'unverified_owner',
    payload: {},
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'PII Blanket Read on Another User Profile',
    collection: 'users/other_uid_999',
    operation: 'get',
    actor: 'non_admin_user',
    payload: {},
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Self-Assigned Owner Privilege Escalation',
    collection: 'users/attacker_uid_1',
    operation: 'create',
    actor: 'non_admin_user',
    payload: {
      uid: 'attacker_uid_1',
      email: 'attacker@example.com',
      display_name: 'Attacker',
      role: 'owner',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized Menu Price Tampering',
    collection: 'menu_items/chicken_roll',
    operation: 'update',
    actor: 'customer',
    payload: { price: 1 },
    expected: 'PERMISSION_DENIED',
  },
];
