import { z } from 'zod';
import { coordinatesSchema } from './ride.validators';

export const registerDriverSchema = z.object({
  body: z.object({
    vehicleType: z.enum(['BIKE', 'AUTO', 'SEDAN', 'SUV']),
    make: z.string().trim().min(1).max(50),
    model: z.string().trim().min(1).max(50),
    licensePlate: z.string().trim().min(2).max(20),
    color: z.string().trim().min(1).max(30),
  }),
});

export const updateDriverStatusSchema = z.object({
  body: z.object({
    status: z.enum(['OFFLINE', 'AVAILABLE', 'BUSY']),
  }),
});

export const updateDriverLocationSchema = z.object({
  body: coordinatesSchema,
});

export type RegisterDriverInput = z.infer<typeof registerDriverSchema>['body'];
export type UpdateDriverStatusInput = z.infer<typeof updateDriverStatusSchema>['body'];
export type UpdateDriverLocationInput = z.infer<typeof updateDriverLocationSchema>['body'];
