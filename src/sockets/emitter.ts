// ─── Socket Event Emitter (via Redis Pub/Sub) ─────────────────────────────────
// The BullMQ worker process (src/workers/) has no direct reference to the
// Socket.IO server instance — that lives in the API process. Rather than
// coupling the worker to Socket.IO directly, both the API's own services
// AND the worker publish ride events to a single Redis Pub/Sub channel.
// The API process subscribes to that channel once (see sockets/index.ts)
// and re-emits each message to the right Socket.IO room.
//
// This is also how a real multi-instance deployment would work: any number
// of worker processes, and any number of API instances behind a load
// balancer, can all publish to the same channel — Redis fans it out to
// every subscriber. (At real scale, you'd pair this with the official
// @socket.io/redis-adapter so room membership itself is shared across API
// instances too; this project keeps a single API instance and makes the
// underlying mechanism explicit instead of hiding it behind that adapter.)
// ─────────────────────────────────────────────────────────────────────────────

import { redis } from '../config/redis';

export const SOCKET_EVENTS_CHANNEL = 'socket-events';

export interface SocketEventMessage {
  room: string;
  event: string;
  payload: unknown;
}

export async function publishSocketEvent(room: string, event: string, payload: unknown): Promise<void> {
  const message: SocketEventMessage = { room, event, payload };
  await redis.publish(SOCKET_EVENTS_CHANNEL, JSON.stringify(message));
}

// Room-naming helpers — kept in one place so producers and the socket
// bootstrap (which joins clients to these rooms) never drift out of sync.
export const rooms = {
  ride: (rideId: string) => `ride:${rideId}`,
  driver: (driverId: string) => `driver:${driverId}`,
  rider: (userId: string) => `rider:${userId}`,
};
