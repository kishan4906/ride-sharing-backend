// ─── Socket.IO Bootstrap ────────────────────────────────────────────────────
// Handles three things:
//   1. Authenticated connections — every socket must present a valid JWT;
//      arbitrary clients cannot subscribe to someone else's ride.
//   2. Room management — riders join their own `rider:{userId}` room,
//      drivers join `driver:{driverId}`, and either side can join a
//      specific `ride:{rideId}` room once we've confirmed they're actually
//      party to that ride.
//   3. Bridging Redis Pub/Sub → Socket.IO — see sockets/emitter.ts for why
//      this exists (the background worker has no direct handle on `io`).
// ─────────────────────────────────────────────────────────────────────────────

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt';
import { driverRepository } from '../repositories/driver.repository';
import { rideRepository } from '../repositories/ride.repository';
import { driverService } from '../services/driver.service';
import { isLocationUpdateAllowed } from '../middleware/rate-limiter';
import { redisSub } from '../config/redis';
import { SOCKET_EVENTS_CHANNEL, SocketEventMessage, rooms } from './emitter';
import { logger } from '../config/logger';
import { env } from '../config/env';

interface SocketData {
  userId: string;
  role: string;
  driverId?: string;
}

export function initSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  // ── Auth middleware: runs once per connection, before 'connection' fires ──
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Authentication token required'));

      const payload = verifyToken(token);
      const data: SocketData = { userId: payload.sub, role: payload.role };

      if (payload.role === 'DRIVER') {
        const driver = await driverRepository.findByUserId(payload.sub);
        if (driver) data.driverId = driver.id;
      }

      socket.data = data;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    logger.debug({ userId: data.userId, role: data.role }, 'socket connected');

    // Every user automatically joins their own personal room, so the
    // backend can reach them (e.g. `ride:no-drivers`) without needing to
    // know their live socket id.
    socket.join(rooms.rider(data.userId));
    if (data.driverId) {
      socket.join(rooms.driver(data.driverId));
    }

    // ── Subscribe to a specific ride's room ──────────────────────────────
    // Explicit opt-in per ride, with an authorization check — this is the
    // guard against "arbitrary users subscribing to another user's ride"
    // called out in the requirements.
    socket.on('ride:subscribe', async ({ rideId }: { rideId: string }) => {
      try {
        const ride = await rideRepository.findById(rideId);
        if (!ride) return socket.emit('error', { message: 'Ride not found' });

        const isRider = ride.riderId === data.userId;
        const isAssignedDriver = ride.driver?.user.id === data.userId;

        if (!isRider && !isAssignedDriver) {
          return socket.emit('error', { message: 'Not authorized to subscribe to this ride' });
        }

        socket.join(rooms.ride(rideId));
        socket.emit('ride:subscribed', { rideId });
      } catch (err) {
        logger.error({ err }, 'ride:subscribe failed');
        socket.emit('error', { message: 'Failed to subscribe to ride' });
      }
    });

    // ── Driver live location during an active ride ───────────────────────
    socket.on(
      'driver:location',
      async ({ rideId, latitude, longitude }: { rideId: string; latitude: number; longitude: number }) => {
        try {
          if (!data.driverId) {
            return socket.emit('error', { message: 'Only drivers can send location updates' });
          }

          // Throttle: a buggy/malicious client sending updates faster than
          // LOCATION_UPDATE_MIN_INTERVAL_MS gets silently dropped (not an
          // error — this is expected under normal GPS polling jitter).
          const allowed = await isLocationUpdateAllowed(data.driverId);
          if (!allowed) return;

          const ride = await rideRepository.findById(rideId);
          if (!ride || ride.driver?.user.id !== data.userId) {
            return socket.emit('error', { message: 'Not authorized to update location for this ride' });
          }

          await driverService.updateLocation(data.userId, latitude, longitude);

          io.to(rooms.ride(rideId)).emit('ride:location', {
            rideId,
            latitude,
            longitude,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          logger.error({ err }, 'driver:location failed');
          socket.emit('error', { message: 'Failed to update location' });
        }
      }
    );

    socket.on('disconnect', () => {
      logger.debug({ userId: data.userId }, 'socket disconnected');
    });
  });

  // ── Redis Pub/Sub → Socket.IO bridge (see sockets/emitter.ts) ───────────
  redisSub.subscribe(SOCKET_EVENTS_CHANNEL, (err) => {
    if (err) logger.error({ err }, 'Failed to subscribe to socket events channel');
  });

  redisSub.on('message', (channel, message) => {
    if (channel !== SOCKET_EVENTS_CHANNEL) return;
    try {
      const { room, event, payload } = JSON.parse(message) as SocketEventMessage;
      io.to(room).emit(event, payload);
    } catch (err) {
      logger.error({ err, message }, 'Failed to parse socket event message');
    }
  });

  return io;
}
