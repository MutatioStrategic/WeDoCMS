import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";

export const cartItemSchema = z.object({
  assetId: z.string().trim().min(1).max(160),
  licenceType: z.enum(["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"]),
  territory: z.string().trim().min(1).max(80),
  durationDays: z.number().int().positive().max(3650),
  creditCost: z.number().int().positive().max(100000),
  includeCustomBuying: z.boolean().default(false),
  addedAt: z.string().datetime(),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type ShoppingCart = {
  id: string;
  organizationId: string;
  buyerId: string;
  items: CartItem[];
  status: "active" | "checked_out" | "abandoned" | "expired";
  totalCredits: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  checkedOutAt: string | null;
  paymentReference: string | null;
};
type CartEnvironment = { DB: D1Database };

export function calculateCartTotals(items: CartItem[]): { totalCredits: number } {
  return { totalCredits: items.reduce((sum, item) => sum + item.creditCost, 0) };
}

function decodeCart(row: Record<string, unknown>): ShoppingCart {
  let items: CartItem[] = [];
  try { items = z.array(cartItemSchema).parse(JSON.parse(String(row.items_json ?? "[]"))); } catch { items = []; }
  return {
    id: String(row.id), organizationId: String(row.organization_id), buyerId: String(row.buyer_id), items,
    status: String(row.status) as ShoppingCart["status"], totalCredits: Number(row.total_credits ?? calculateCartTotals(items).totalCredits),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), expiresAt: row.expires_at ? String(row.expires_at) : null,
    checkedOutAt: row.checked_out_at ? String(row.checked_out_at) : null, paymentReference: row.payment_reference ? String(row.payment_reference) : null,
  };
}

function cartHasExpired(cart: ShoppingCart): boolean {
  return cart.status === "active" && Boolean(cart.expiresAt) && Number.isFinite(Date.parse(cart.expiresAt!)) && Date.parse(cart.expiresAt!) <= Date.now();
}

export async function getCart(env: CartEnvironment, cartId: string, organizationId: string, buyerId: string): Promise<ShoppingCart | null> {
  const row = await env.DB.prepare("SELECT * FROM shopping_carts WHERE id = ? AND organization_id = ? AND buyer_id = ?")
    .bind(cartId, organizationId, buyerId).first<Record<string, unknown>>();
  const cart = row ? decodeCart(row) : null;
  if (!cart || !cartHasExpired(cart)) return cart;
  await env.DB.prepare("UPDATE shopping_carts SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND buyer_id = ? AND status = 'active'")
    .bind(cart.id, organizationId, buyerId).run();
  return { ...cart, status: "expired", updatedAt: new Date().toISOString() };
}

export async function createCart(env: CartEnvironment, organizationId: string, buyerId: string): Promise<ShoppingCart> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO shopping_carts (id, organization_id, buyer_id, items_json, status, total_credits, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, '[]', 'active', 0, ?, ?, ?)`)
    .bind(id, organizationId, buyerId, now, now, expiresAt).run();
  return { id, organizationId, buyerId, items: [], status: "active", totalCredits: 0, createdAt: now, updatedAt: now, expiresAt, checkedOutAt: null, paymentReference: null };
}

export async function saveCartItems(env: CartEnvironment, cart: ShoppingCart, items: CartItem[]): Promise<ShoppingCart> {
  if (cart.status !== "active" || cartHasExpired(cart)) throw new Error("Cart is not active");
  const next = { ...cart, items, totalCredits: calculateCartTotals(items).totalCredits, updatedAt: new Date().toISOString() };
  await env.DB.prepare("UPDATE shopping_carts SET items_json = ?, total_credits = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND buyer_id = ? AND status = 'active'")
    .bind(JSON.stringify(next.items), next.totalCredits, next.updatedAt, cart.id, cart.organizationId, cart.buyerId).run();
  return next;
}

export async function cleanupExpiredCarts(env: CartEnvironment): Promise<number> {
  const result = await env.DB.prepare("UPDATE shopping_carts SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND expires_at IS NOT NULL AND datetime(expires_at) <= CURRENT_TIMESTAMP").run();
  return Number(result.meta?.changes ?? 0);
}
