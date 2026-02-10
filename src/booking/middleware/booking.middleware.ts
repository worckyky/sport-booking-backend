import { Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import { AuthRequest } from '../../authentication/middleware/auth.middleware';
import { isValidUUID } from '../../utils/uuid';

// Проверяет что пользователь не заблокирован (для создания брони)
export const notBlockedMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await db.query<{ is_blocked: boolean }>(
        'SELECT is_blocked FROM users WHERE id = $1',
        [req.userId]
      );

      if (result.rows.length === 0) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      if (result.rows[0].is_blocked) {
        res.status(403).json({ error: 'Your account is blocked. Please contact support.' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

// Проверяет что у пользователя не превышен лимит активных бронирований
export const activeBookingLimitMiddleware = (db: Pool, maxBookings = 10) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
      }

      const result = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE user_id = $1 AND status IN ('pending', 'confirmed')`,
        [req.userId]
      );

      const count = parseInt(result.rows[0].count, 10);
      if (count >= maxBookings) {
        res.status(429).json({
          error: {
            code: 'BOOKING_LIMIT_EXCEEDED',
            message: `Достигнут лимит активных бронирований (${maxBookings})`
          }
        });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    }
  };
};

// Проверяет что пользователь — владелец площадки (campaign), к которой относится field
export const fieldOwnerMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const fieldId = req.params.id || req.body.field_id;

      if (!fieldId) {
        res.status(400).json({ error: 'Field ID required' });
        return;
      }

      if (!isValidUUID(fieldId)) {
        res.status(400).json({ error: 'Invalid field ID format' });
        return;
      }

      const result = await db.query<{ user_id: string }>(
        `SELECT c.user_id
         FROM fields f
         JOIN campaign_info c ON f.campaign_id = c.id
         WHERE f.id = $1`,
        [fieldId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Field not found' });
        return;
      }

      if (result.rows[0].user_id !== req.userId) {
        res.status(403).json({ error: 'Forbidden - Not the owner of this field' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

// Проверяет что пользователь — владелец площадки, к которой относится slot
export const slotOwnerMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slotId = req.params.id || req.body.slot_id;

      if (!slotId) {
        res.status(400).json({ error: 'Slot ID required' });
        return;
      }

      if (!isValidUUID(slotId)) {
        res.status(400).json({ error: 'Invalid slot ID format' });
        return;
      }

      const result = await db.query<{ user_id: string }>(
        `SELECT c.user_id
         FROM booking_slots s
         JOIN fields f ON s.field_id = f.id
         JOIN campaign_info c ON f.campaign_id = c.id
         WHERE s.id = $1`,
        [slotId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Slot not found' });
        return;
      }

      if (result.rows[0].user_id !== req.userId) {
        res.status(403).json({ error: 'Forbidden - Not the owner of this slot' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

// Проверяет что пользователь — владелец площадки, к которой относится booking
export const bookingCampaignOwnerMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const bookingId = req.params.id;

      if (!bookingId) {
        res.status(400).json({ error: 'Booking ID required' });
        return;
      }

      if (!isValidUUID(bookingId)) {
        res.status(400).json({ error: 'Invalid booking ID format' });
        return;
      }

      const result = await db.query<{ user_id: string }>(
        `SELECT c.user_id
         FROM bookings b
         JOIN booking_slots s ON b.slot_id = s.id
         JOIN fields f ON s.field_id = f.id
         JOIN campaign_info c ON f.campaign_id = c.id
         WHERE b.id = $1`,
        [bookingId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }

      if (result.rows[0].user_id !== req.userId) {
        res.status(403).json({ error: 'Forbidden - Not the owner of this campaign' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

// Проверяет что пользователь — владелец campaign_id (для создания field)
export const campaignOwnerMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const campaignId = req.body.campaign_id || req.query.campaign_id;

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID required' });
        return;
      }

      if (!isValidUUID(campaignId)) {
        res.status(400).json({ error: 'Invalid campaign ID format' });
        return;
      }

      const result = await db.query<{ user_id: string }>(
        'SELECT user_id FROM campaign_info WHERE id = $1',
        [campaignId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }

      if (result.rows[0].user_id !== req.userId) {
        res.status(403).json({ error: 'Forbidden - Not the owner of this campaign' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};
