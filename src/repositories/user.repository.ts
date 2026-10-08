import { prisma } from '../config/db';
import { Prisma, Role } from '@prisma/client';

export const userRepository = {
  create(data: { name: string; email: string; phone: string; passwordHash: string; role: Role }) {
    return prisma.user.create({ data });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findByPhone(phone: string) {
    return prisma.user.findUnique({ where: { phone } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByIdWithDriver(id: string) {
    return prisma.user.findUnique({ where: { id }, include: { driver: { include: { vehicle: true } } } });
  },
};

export type UserRepository = typeof userRepository;
