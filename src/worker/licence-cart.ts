/**
 * Shopping cart abstraction for multi-asset licensing.
 * Enables buyers to add multiple assets to a cart, apply credits or subscription benefits,
 * and checkout with a single payment covering all licences.
 */

import { z } from "zod";

export const cartItemSchema = z.object({
  assetId: z.string().min(1),
  licenceType: z.enum(["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"]),
  territory: z.string().min(1).max(80),
  durationDays: z.number().int().positive().max(3650),
  priceCents: z.number().int().nonnegative(),
  royaltyCents: z.number().int().nonnegative(),
  addedAt: z.string(),
});

export type CartItem = z.infer<typeof cartItemSchema>;

export const shoppingCartSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  buyerId: z.string().min(1),
  items: z.array(cartItemSchema),
  status: z.enum(["active", "checked_out", "abandoned", "expired"]),
  subtotalCents: z.number().int().nonnegative(),
  totalRoyaltyCents: z.number().int().nonnegative(),
  creditsApplied: z.number().int().nonnegative().default(0),
  discountCents: z.number().int().nonnegative().default(0),
  finalTotalCents: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().nullable(),
  checkedOutAt: z.string().nullable(),
  paymentReference: z.string().nullable(),
});

export type ShoppingCart = z.infer<typeof shoppingCartSchema>;

/** Calculate cart totals including discounts and credits */
export function calculateCartTotals(
  items: CartItem[],
  creditsAvailable: number,
  discountCents: number = 0
): { subtotalCents: number; totalRoyaltyCents: number; creditsApplied: number; finalTotalCents: number } {
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents, 0);
  const totalRoyaltyCents = items.reduce((sum, item) => sum + item.royaltyCents, 0);
  
  // Apply fixed discount first
  let amountDue = Math.max(0, subtotalCents - discountCents);
  
  // Apply credits (1 credit = 10000 cents worth of licences)
  const creditsToApply = Math.min(creditsAvailable, Math.ceil(amountDue / 10000));
  const creditsAppliedCents = creditsToApply * 10000;
  
  amountDue = Math.max(0, amountDue - creditsAppliedCents);
  
  return {
    subtotalCents,
    totalRoyaltyCents,
    creditsApplied: creditsToApply,
    finalTotalCents: amountDue,
  };
}

/** Validate that all items in cart are still available for licensing */
export async function validateCartItems(
  env: Env,
  organizationId: string,
  items: CartItem[]
): Promise<{ valid: boolean; invalidItems: string[]; reasons: Record<string, string> }> {
  if (items.length === 0) return { valid: true, invalidItems: [], reasons: {} };
  
  const assetIds = items.map(i => i.assetId);
  const placeholders = assetIds.map(() => "?").join(",");
  
  const query = `
    SELECT id, status, owner_id 
    FROM assets 
    WHERE id IN (${placeholders}) AND organization_id = ?
  `;
  
  const results = await env.DB.prepare(query)
    .bind(...assetIds, organizationId)
    .all<{ id: string; status: string; owner_id: string }>();
  
  const assetMap = new Map(results.results.map(a => [a.id, a]));
  const invalidItems: string[] = [];
  const reasons: Record<string, string> = {};
  
  for (const item of items) {
    const asset = assetMap.get(item.assetId);
    if (!asset) {
      invalidItems.push(item.assetId);
      reasons[item.assetId] = "Asset not found";
    } else if (asset.status !== "published") {
      invalidItems.push(item.assetId);
      reasons[item.assetId] = `Asset status is ${asset.status}, not available for licensing`;
    }
  }
  
  return {
    valid: invalidItems.length === 0,
    invalidItems,
    reasons,
  };
}

/** Create a new shopping cart */
export async function createCart(
  env: Env,
  organizationId: string,
  buyerId: string
): Promise<ShoppingCart> {
  const cartId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
  
  const cart: ShoppingCart = {
    id: cartId,
    organizationId,
    buyerId,
    items: [],
    status: "active",
    subtotalCents: 0,
    totalRoyaltyCents: 0,
    creditsApplied: 0,
    discountCents: 0,
    finalTotalCents: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    checkedOutAt: null,
    paymentReference: null,
  };
  
  await env.DB.prepare(`
    INSERT INTO shopping_carts (id, organization_id, buyer_id, items_json, status, subtotal_cents, total_royalty_cents, 
      credits_applied, discount_cents, final_total_cents, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    cartId, organizationId, buyerId, JSON.stringify([]), "active", 0, 0, 0, 0, 0, now, now, expiresAt
  ).run();
  
  return cart;
}

/** Add item to cart */
export async function addToCart(
  env: Env,
  cartId: string,
  item: CartItem,
  organizationId: string
): Promise<ShoppingCart> {
  const cart = await getCart(env, cartId, organizationId);
  if (!cart) throw new Error("Cart not found");
  if (cart.status !== "active") throw new Error("Cart is not active");
  
  // Check if item already exists
  const existingIndex = cart.items.findIndex(
    i => i.assetId === item.assetId && 
         i.licenceType === item.licenceType && 
         i.territory === item.territory && 
         i.durationDays === item.durationDays
  );
  
  if (existingIndex >= 0) {
    // Update quantity or skip (depending on business logic)
    throw new Error("Duplicate item in cart");
  }
  
  cart.items.push(item);
  cart.updatedAt = new Date().toISOString();
  
  // Recalculate totals
  const totals = calculateCartTotals(cart.items, 0, cart.discountCents);
  cart.subtotalCents = totals.subtotalCents;
  cart.totalRoyaltyCents = totals.totalRoyaltyCents;
  cart.finalTotalCents = totals.finalTotalCents;
  
  await env.DB.prepare(`
    UPDATE shopping_carts 
    SET items_json = ?, subtotal_cents = ?, total_royalty_cents = ?, final_total_cents = ?, updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).bind(JSON.stringify(cart.items), cart.subtotalCents, cart.totalRoyaltyCents, cart.finalTotalCents, cart.updatedAt, cartId, organizationId).run();
  
  return cart;
}

/** Get cart by ID */
export async function getCart(
  env: Env,
  cartId: string,
  organizationId: string
): Promise<ShoppingCart | null> {
  const row = await env.DB.prepare(`
    SELECT * FROM shopping_carts 
    WHERE id = ? AND organization_id = ?
  `).bind(cartId, organizationId).first<Record<string, unknown>>();
  
  if (!row) return null;
  
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    buyerId: String(row.buyer_id),
    items: JSON.parse(String(row.items_json)) as CartItem[],
    status: String(row.status) as ShoppingCart["status"],
    subtotalCents: Number(row.subtotal_cents),
    totalRoyaltyCents: Number(row.total_royalty_cents),
    creditsApplied: Number(row.credits_applied),
    discountCents: Number(row.discount_cents),
    finalTotalCents: Number(row.final_total_cents),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    checkedOutAt: row.checked_out_at ? String(row.checked_out_at) : null,
    paymentReference: row.payment_reference ? String(row.payment_reference) : null,
  };
}

/** Checkout cart - create all licences and process payment */
export async function checkoutCart(
  env: Env,
  cartId: string,
  organizationId: string,
  paymentReference: string
): Promise<{ success: boolean; licenceIds: string[]; error?: string }> {
  const cart = await getCart(env, cartId, organizationId);
  if (!cart) return { success: false, licenceIds: [], error: "Cart not found" };
  if (cart.status !== "active") return { success: false, licenceIds: [], error: "Cart is not active" };
  if (cart.items.length === 0) return { success: false, licenceIds: [], error: "Cart is empty" };
  
  const licenceIds: string[] = [];
  const now = new Date().toISOString();
  
  try {
    // Create licences for all items
    for (const item of cart.items) {
      const licenceId = crypto.randomUUID();
      
      await env.DB.prepare(`
        INSERT INTO licences (id, organization_id, asset_id, owner_id, licence_type, territory, duration_days, 
          price_cents, royalty_cents, status, created_at)
        SELECT ?, ?, ?, owner_id, ?, ?, ?, ?, ?, 'pending', ?
        FROM assets WHERE id = ? AND organization_id = ?
      `).bind(
        licenceId, organizationId, item.assetId, item.licenceType, item.territory, 
        item.durationDays, item.priceCents, item.royaltyCents, now, item.assetId, organizationId
      ).run();
      
      licenceIds.push(licenceId);
    }
    
    // Mark cart as checked out
    await env.DB.prepare(`
      UPDATE shopping_carts 
      SET status = 'checked_out', checked_out_at = ?, payment_reference = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).bind(now, paymentReference, now, cartId, organizationId).run();
    
    return { success: true, licenceIds };
  } catch (error) {
    // Rollback: mark cart as abandoned
    await env.DB.prepare(`
      UPDATE shopping_carts SET status = 'abandoned', updated_at = ? WHERE id = ? AND organization_id = ?
    `).bind(now, cartId, organizationId).run();
    
    return { 
      success: false, 
      licenceIds: [], 
      error: error instanceof Error ? error.message : "Checkout failed" 
    };
  }
}

/** Abandon cart */
export async function abandonCart(
  env: Env,
  cartId: string,
  organizationId: string
): Promise<void> {
  await env.DB.prepare(`
    UPDATE shopping_carts SET status = 'abandoned', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ? AND organization_id = ?
  `).bind(cartId, organizationId).run();
}

/** Clean up expired carts */
export async function cleanupExpiredCarts(env: Env): Promise<number> {
  const result = await env.DB.prepare(`
    UPDATE shopping_carts SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'active' AND expires_at < CURRENT_TIMESTAMP
  `).run();
  
  return result.meta?.rows_written ?? 0;
}
