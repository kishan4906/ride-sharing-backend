import { Router } from 'express';
import authRoutes from './auth.routes';
import driverRoutes from './driver.routes';
import rideRoutes from './ride.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/drivers', driverRoutes);
router.use('/rides', rideRoutes);

export default router;
