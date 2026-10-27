import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { verifyAdminToken } from "../auth/token.js";
import { isOriginAllowed } from "../config/cors.js";
import { findOrder } from "../repositories/order.repository.js";
import { findTableSessionByToken } from "../repositories/table-session.repository.js";
import type { OrderDto } from "../types/order.js";
import { logger } from "../utils/logger.js";

/**
 * Socket.IO realtime layer.
 *
 * Single-process by design: `io` is an in-memory hub attached to the API's
 * HTTP server. Horizontal scaling would require the Redis
 * (`@socket.io/redis-adapter`) broadcaster plus sticky sessions — out of
 * scope until there is more than one backend replica.
 *
 * Protocol
 * - Handshake `auth: { token }` (optional): admin JWT. Valid COFFEE_ADMIN
 *   sockets auto-join `coffee:{coffeeId}` and receive `order:new` /
 *   `order:updated`. Invalid tokens are rejected at handshake time.
 *   Anonymous sockets (customers) connect without a token and may only
 *   subscribe to an order they can prove ownership of with its table-session
 *   token (legacy orders without a session stay readable by id).
 * - `order:subscribe { orderId, sessionToken? }` / `order:unsubscribe
 *   { orderId }` (client to server): join/leave `order:{orderId}`, receiving
 *   `order:updated`.
 * - `session:subscribe { sessionToken }` / `session:unsubscribe { sessionToken }`
 *   (client to server): join/leave `session:{tableSessionId}`, receiving every
 *   order event of that table session. The token is verified server-side, so a
 *   client can only watch a session it owns.
 *
 * Events (server to client):
 * - `order:new`     — an order was placed; payload OrderDto (no sessionToken).
 * - `order:updated` — status or payment changed; payload OrderDto.
 */

interface SocketData {
  admin?: { role: "APP_ADMIN" | "COFFEE_ADMIN"; coffeeId?: string };
}

/** Public order payload — never carries the session token. */
type PublicOrder = Omit<OrderDto, "sessionToken">;

interface ClientToServerEvents {
  "order:subscribe": (orderId: string, sessionToken?: string, ack?: (result: { joined: boolean }) => void) => void;
  "order:unsubscribe": (orderId: string) => void;
  "session:subscribe": (sessionToken: string, ack?: (result: { joined: boolean }) => void) => void;
  "session:unsubscribe": (sessionToken: string) => void;
}

interface ServerToClientEvents {
  "order:new": (order: PublicOrder) => void;
  "order:updated": (order: PublicOrder) => void;
}

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const ORDER_NEW_EVENT = "order:new";
export const ORDER_UPDATED_EVENT = "order:updated";
export const ORDER_SUBSCRIBE_EVENT = "order:subscribe";
export const ORDER_UNSUBSCRIBE_EVENT = "order:unsubscribe";
export const SESSION_SUBSCRIBE_EVENT = "session:subscribe";
export const SESSION_UNSUBSCRIBE_EVENT = "session:unsubscribe";

let io: RealtimeServer | null = null;

function coffeeRoom(coffeeId: string): string {
  return `coffee:${coffeeId}`;
}

function orderRoom(orderId: string): string {
  return `order:${orderId}`;
}

function sessionRoom(tableSessionId: string): string {
  return `session:${tableSessionId}`;
}

/** The room of the table session an order belongs to, when it has one. */
function sessionRooms(order: OrderDto): string[] {
  return order.tableSessionId ? [sessionRoom(order.tableSessionId)] : [];
}

async function resolveSessionRoom(sessionToken: unknown): Promise<string | null> {
  if (typeof sessionToken !== "string" || sessionToken.length < 20 || sessionToken.length > 256) return null;
  const session = await findTableSessionByToken(sessionToken);
  return session ? sessionRoom(session._id.toString()) : null;
}

/**
 * An order is readable without credentials only when it predates table
 * sessions. Session-bound orders require the token of their own session.
 */
async function canAccessOrder(orderId: string, sessionToken: unknown): Promise<boolean> {
  const order = await findOrder(orderId);
  if (!order) return false;
  if (!order.tableSessionId) return true;
  if (typeof sessionToken !== "string" || sessionToken.length < 20 || sessionToken.length > 256) return false;
  const session = await findTableSessionByToken(sessionToken);
  return session !== null && session._id.toString() === order.tableSessionId.toString();
}

function registerClientEvents(socket: RealtimeSocket): void {
  // The ack tells the client (and tests) when the room join is actually in
  // place �?" without it, an emit right after subscribe could race the join.
  socket.on(ORDER_SUBSCRIBE_EVENT, async (orderId, sessionToken, ack) => {
    if (typeof orderId === "string" && /^[0-9a-fA-F]{24}$/.test(orderId)) {
      try {
        if (!(await canAccessOrder(orderId, sessionToken))) {
          ack?.({ joined: false });
          return;
        }
        await socket.join(orderRoom(orderId));
        ack?.({ joined: true });
        return;
      } catch {
        ack?.({ joined: false });
        return;
      }
    }
    ack?.({ joined: false });
  });
  socket.on(ORDER_UNSUBSCRIBE_EVENT, (orderId) => {
    if (typeof orderId !== "string") return;
    void socket.leave(orderRoom(orderId));
  });
  socket.on(SESSION_SUBSCRIBE_EVENT, async (sessionToken, ack) => {
    try {
      const room = await resolveSessionRoom(sessionToken);
      if (!room) {
        ack?.({ joined: false });
        return;
      }
      await socket.join(room);
      ack?.({ joined: true });
    } catch {
      ack?.({ joined: false });
    }
  });
  socket.on(SESSION_UNSUBSCRIBE_EVENT, (sessionToken) => {
    void resolveSessionRoom(sessionToken).then((room) => {
      if (room) void socket.leave(room);
    });
  });
}

async function authenticateAdmin(socket: RealtimeSocket): Promise<void> {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string" || !token) return; // anonymous customer socket

  try {
    const payload = await verifyAdminToken(token);
    socket.data.admin = { role: payload.role, coffeeId: payload.coffeeId };
    if (payload.role === "COFFEE_ADMIN" && payload.coffeeId) {
      await socket.join(coffeeRoom(payload.coffeeId));
    }
  } catch {
    // No sensitive detail to the client; REST uses the same reject rule.
    throw new Error("unauthorized");
  }
}

export function initRealtime(server: HttpServer): RealtimeServer {
  if (io) return io;

  const socketServer = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    server,
    {
      cors: {
        origin: (origin, callback) => {
          if (isOriginAllowed(origin)) callback(null, true);
          else callback(new Error("Origin not allowed by CORS"));
        },
        methods: ["GET", "POST"],
        credentials: false,
      },
      // Same path prefix discipline as the REST API.
      path: "/socket.io",
    },
  );

  // Handshake auth: reject admin-shaped handshakes carrying a bad token
  // before the connection is established.
  socketServer.use(async (socket, next) => {
    try {
      await authenticateAdmin(socket as RealtimeSocket);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  socketServer.on("connection", (socket) => {
    registerClientEvents(socket as RealtimeSocket);
  });

  io = socketServer;
  logger.info("Socket.IO realtime layer initialized");
  return socketServer;
}

export function closeRealtime(): void {
  if (!io) return;
  const server = io;
  io = null;
  server.close();
}

/**
 * Publish helpers. Safe to call from services whether or not the realtime
 * layer is running (it is not initialized in most unit tests).
 */

export function publishOrderCreated(order: OrderDto): void {
  if (!io) return;
  // Never broadcast the session token — it only belongs to the ordering
  // client's own response body.
  const { sessionToken: _sessionToken, ...payload } = order;
  // Single emit over the union of the rooms: Socket.IO delivers at most once
  // per socket even when it sits in several (dedup is per-socket).
  io.to([coffeeRoom(order.coffeeId), ...sessionRooms(order)]).emit(ORDER_NEW_EVENT, payload);
}

export function publishOrderUpdated(order: OrderDto): void {
  if (!io) return;
  const { sessionToken: _sessionToken, ...payload } = order;
  io.to([coffeeRoom(order.coffeeId), orderRoom(order.id), ...sessionRooms(order)]).emit(ORDER_UPDATED_EVENT, payload);
}
