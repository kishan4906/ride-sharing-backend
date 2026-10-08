// ─── Payment Service (mocked) ──────────────────────────────────────────────
// This project does not integrate a real payment gateway (Stripe, Razorpay,
// etc.) — that's explicitly out of scope for a backend-architecture
// learning project. What's real here is the SHAPE of the integration: a
// Payment row is created when a ride completes, and its status transitions
// (PENDING → COMPLETED/FAILED) the same way a real gateway webhook would
// drive it. Swapping this mock for a real gateway later would mean
// replacing the body of `charge()` — the rest of the app wouldn't change.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import { paymentRepository } from '../repositories/payment.repository';
import { PaymentMethod } from '@prisma/client';

export const paymentService = {
  async createAndCharge(rideId: string, amount: number, method: PaymentMethod) {
    const payment = await paymentRepository.create({ rideId, amount, paymentMethod: method });

    // CASH "settles" immediately (money changes hands in person, no gateway
    // involved). CARD/WALLET simulate a near-instant gateway confirmation —
    // in a real integration this would instead be driven by a webhook
    // handler, asynchronously, and the ride wouldn't block waiting for it.
    if (method === 'CASH') {
      return paymentRepository.updateStatus(rideId, 'COMPLETED', `cash_${uuid()}`);
    }

    const transactionId = `mock_txn_${uuid()}`;
    // Simulate a payment that (almost) always succeeds — small deliberate
    // failure rate so the FAILED path is reachable/testable.
    const succeeded = Math.random() > 0.02;
    return paymentRepository.updateStatus(rideId, succeeded ? 'COMPLETED' : 'FAILED', transactionId);
  },
};
