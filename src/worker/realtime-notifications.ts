/**
 * WebSocket-based real-time notification service for royalty updates,
 * payout status changes, and credit purchase confirmations.
 */

import type { DurableObjectState, WebSocket } from "@cloudflare/workers-types";

export type NotificationType = "royalty" | "payout" | "credit" | "licence" | "system";

export type RealtimeNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  amountCents?: number;
  currency?: string;
  timestamp: string;
  read?: boolean;
};

export type NotificationMessage = 
  | { type: "notification"; data: RealtimeNotification }
  | { type: "batch"; notifications: RealtimeNotification[] }
  | { type: "heartbeat"; timestamp: string };

export type SubscriptionFilter = {
  types?: NotificationType[];
  resourceTypes?: string[];
  minAmountCents?: number;
};

export class RealtimeNotificationDO {
  private state: DurableObjectState;
  private connections = new Map<string, WebSocket>();
  private subscriptions = new Map<string, Set<SubscriptionFilter>>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    if (url.pathname === "/send" && request.method === "POST") {
      return this.handleSendNotification(request);
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    const userId = request.headers.get("X-User-ID") ?? "anonymous";
    const organizationId = request.headers.get("X-Organization-ID");

    this.connections.set(userId, server);
    
    if (organizationId) {
      const filters = new Set<SubscriptionFilter>();
      filters.add({ types: ["royalty", "payout", "licence"] });
      this.subscriptions.set(userId, filters);
    }

    server.accept();
    server.send(JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() } as NotificationMessage));

    server.addEventListener("message", async (event) => {
      try {
        const message = JSON.parse(event.data as string) as { type: string; filters?: SubscriptionFilter[] };
        if (message.type === "subscribe" && message.filters) {
          this.subscriptions.set(userId, new Set(message.filters));
        }
      } catch {
        // Ignore invalid messages
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(userId);
      this.subscriptions.delete(userId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleSendNotification(request: Request): Promise<Response> {
    const payload = await request.json() as { 
      userId: string; 
      notification: RealtimeNotification;
      filter?: SubscriptionFilter;
    };

    const { userId, notification } = payload;
    const connection = this.connections.get(userId);
    
    if (connection && connection.readyState === WebSocket.prototype.OPEN) {
      const shouldSend = this.shouldSendNotification(userId, notification);
      if (shouldSend) {
        connection.send(JSON.stringify({ type: "notification", data: notification } as NotificationMessage));
      }
    }

    // Persist notification to storage
    await this.state.storage.put(`notification:${userId}:${notification.id}`, notification);

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const payload = await request.json() as { 
      organizationId: string;
      notification: RealtimeNotification;
      userFilters?: Map<string, SubscriptionFilter>;
    };

    const { organizationId, notification } = payload;
    let sentCount = 0;

    for (const [userId, connection] of this.connections.entries()) {
      if (connection.readyState !== WebSocket.prototype.OPEN) continue;
      
      const shouldSend = this.shouldSendNotification(userId, notification);
      if (shouldSend) {
        connection.send(JSON.stringify({ type: "notification", data: notification } as NotificationMessage));
        sentCount++;
      }
    }

    return new Response(JSON.stringify({ ok: true, sentCount }), { headers: { "Content-Type": "application/json" } });
  }

  private shouldSendNotification(userId: string, notification: RealtimeNotification): boolean {
    const filters = this.subscriptions.get(userId);
    if (!filters || filters.size === 0) return true;

    for (const filter of filters) {
      const typeMatch = !filter.types || filter.types.includes(notification.type);
      const resourceMatch = !filter.resourceTypes || (notification.resourceType && filter.resourceTypes.includes(notification.resourceType));
      const amountMatch = !filter.minAmountCents || (notification.amountCents && notification.amountCents >= filter.minAmountCents);
      
      if (typeMatch && resourceMatch && amountMatch) return true;
    }

    return false;
  }

  async getNotifications(userId: string, limit = 50): Promise<RealtimeNotification[]> {
    const keys = await this.state.storage.list<RealtimeNotification>({ prefix: `notification:${userId}:` });
    const notifications = Array.from(keys.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return notifications.slice(0, limit);
  }

  async markAsRead(userId: string, notificationIds: string[]): Promise<void> {
    for (const id of notificationIds) {
      const key = `notification:${userId}:${id}`;
      const notification = await this.state.storage.get<RealtimeNotification>(key);
      if (notification) {
        notification.read = true;
        await this.state.storage.put(key, notification);
      }
    }
  }
}

/** Helper to send notifications from the main worker */
export async function sendRealtimeNotification(
  env: Env,
  userId: string,
  notification: Omit<RealtimeNotification, "id" | "timestamp">
): Promise<void> {
  const notificationId = crypto.randomUUID();
  const fullNotification: RealtimeNotification = {
    ...notification,
    id: notificationId,
    timestamp: new Date().toISOString(),
  };

  const stub = env.REALTIME_NOTIFICATION_DO.get(env.REALTIME_NOTIFICATION_DO.idFromName(userId));
  await stub.fetch("http://do/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, notification: fullNotification }),
  });
}

/** Broadcast notification to all users in an organization */
export async function broadcastRealtimeNotification(
  env: Env,
  organizationId: string,
  notification: Omit<RealtimeNotification, "id" | "timestamp">
): Promise<{ sentCount: number }> {
  const notificationId = crypto.randomUUID();
  const fullNotification: RealtimeNotification = {
    ...notification,
    id: notificationId,
    timestamp: new Date().toISOString(),
  };

  const stub = env.REALTIME_NOTIFICATION_DO.get(env.REALTIME_NOTIFICATION_DO.idFromName(`org:${organizationId}`));
  const response = await stub.fetch("http://do/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, notification: fullNotification }),
  });

  return response.json<{ sentCount: number }>();
}
