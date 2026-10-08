import { z } from 'zod';

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const createRideSchema = z.object({
  body: z.object({
    pickup: coordinatesSchema,
    destination: coordinatesSchema,
    vehicleType: z.enum(['BIKE', 'AUTO', 'SEDAN', 'SUV']),
  }),
});

export const rideIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid ride id'),
  }),
});

export const rateRideSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid ride id'),
  }),
  body: z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).optional(),
  }),
});

export type CreateRideInput = z.infer<typeof createRideSchema>['body'];
export type RateRideInput = z.infer<typeof rateRideSchema>['body'];
