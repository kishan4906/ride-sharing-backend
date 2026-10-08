import swaggerJsdoc from 'swagger-jsdoc';
import { env } from '../config/env';

const options: swaggerJsdoc.OAS3Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ride-Sharing Backend API',
      version: '1.0.0',
      description:
        'A simplified, educational Uber/Ola-style ride-sharing backend. Demonstrates clean layered architecture, Redis geospatial driver matching, real-time Socket.IO updates, and background job processing with BullMQ.',
    },
    servers: [{ url: `http://localhost:${env.PORT}/api/v1`, description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
