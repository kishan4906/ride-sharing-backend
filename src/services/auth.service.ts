import { userRepository } from '../repositories/user.repository';
import { driverRepository } from '../repositories/driver.repository';
import { hashPassword, verifyPassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { ConflictError, UnauthorizedError, NotFoundError } from '../errors/AppError';
import { RegisterInput, LoginInput } from '../validators/auth.validators';

export const authService = {
  async register(input: RegisterInput) {
    const [existingEmail, existingPhone] = await Promise.all([
      userRepository.findByEmail(input.email),
      userRepository.findByPhone(input.phone),
    ]);

    if (existingEmail) throw new ConflictError('An account with this email already exists');
    if (existingPhone) throw new ConflictError('An account with this phone number already exists');

    const passwordHash = await hashPassword(input.password);
    const user = await userRepository.create({
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
    });

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    return { user: sanitizeUser(user), token };
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmail(input.email);
    if (!user) throw new UnauthorizedError('Invalid email or password');

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    return { user: sanitizeUser(user), token };
  },

  async getCurrentUser(userId: string) {
    const user = await userRepository.findByIdWithDriver(userId);
    if (!user) throw new NotFoundError('User not found');

    return {
      ...sanitizeUser(user),
      driver: user.driver ? { id: user.driver.id, status: user.driver.status, vehicle: user.driver.vehicle } : null,
    };
  },
};

function sanitizeUser<T extends { passwordHash: string }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}
