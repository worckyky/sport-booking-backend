import { Router, Response } from 'express';
import { Pool } from 'pg';
import { BookingAPI } from '../api/booking.api';
import { authMiddleware, AuthRequest } from '../../authentication/middleware/auth.middleware';
import {
  fieldOwnerMiddleware,
  slotOwnerMiddleware,
  bookingCampaignOwnerMiddleware,
  campaignOwnerMiddleware
} from '../middleware/booking.middleware';
import { isValidUUID } from '../../utils/uuid';

export default function createBookingRoutes(db: Pool): Router {
  const router = Router();
  const api = new BookingAPI(db);

  // ==================== FIELDS ====================

  // GET /booking/fields?campaign_id= — список полей площадки (публичный)
  router.get('/fields', async (req: AuthRequest, res: Response) => {
    try {
      const { campaign_id } = req.query;
      if (!campaign_id || typeof campaign_id !== 'string') {
        res.status(400).json({ error: 'campaign_id query parameter required' });
        return;
      }
      if (!isValidUUID(campaign_id)) {
        res.status(400).json({ error: 'Invalid campaign_id format' });
        return;
      }
      const fields = await api.getFieldsByCampaign(campaign_id);
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /booking/fields/:id — детали поля (публичный)
  router.get('/fields/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!isValidUUID(req.params.id)) {
        res.status(400).json({ error: 'Invalid field ID format' });
        return;
      }
      const field = await api.getFieldById(req.params.id);
      if (!field) {
        res.status(404).json({ error: 'Field not found' });
        return;
      }
      res.json(field);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /booking/fields — создать поле (только владелец campaign)
  router.post(
    '/fields',
    authMiddleware(db),
    campaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const {
          campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
          slot_duration, working_hours_from, working_hours_to, working_days, client_info
        } = req.body;

        // Валидация обязательных полей
        if (!campaign_id || !name) {
          res.status(400).json({ error: 'campaign_id and name are required' });
          return;
        }
        if (!sport_types || !Array.isArray(sport_types) || sport_types.length === 0) {
          res.status(400).json({ error: 'sport_types array is required' });
          return;
        }
        if (typeof is_indoor !== 'boolean') {
          res.status(400).json({ error: 'is_indoor boolean is required' });
          return;
        }
        if (!photos || !Array.isArray(photos) || photos.length === 0) {
          res.status(400).json({ error: 'At least one photo is required' });
          return;
        }
        if (typeof price_per_hour !== 'number' || price_per_hour <= 0) {
          res.status(400).json({ error: 'price_per_hour must be a positive number' });
          return;
        }

        const field = await api.createField({
          campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
          slot_duration, working_hours_from, working_hours_to, working_days, client_info
        });
        res.status(201).json(field);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    }
  );

  // PUT /booking/fields/:id — обновить поле (только владелец)
  router.put(
    '/fields/:id',
    authMiddleware(db),
    fieldOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const {
          name, sport_types, is_indoor, photos, price_per_hour, status,
          slot_duration, working_hours_from, working_hours_to, working_days, client_info
        } = req.body;

        // Валидация status если передан
        if (status !== undefined) {
          const validStatuses = ['active', 'disabled'];
          if (!validStatuses.includes(status)) {
            res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
            return;
          }
        }

        const field = await api.updateField(req.params.id, {
          name, sport_types, is_indoor, photos, price_per_hour, status,
          slot_duration, working_hours_from, working_hours_to, working_days, client_info
        });
        if (!field) {
          res.status(404).json({ error: 'Field not found' });
          return;
        }
        res.json(field);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /booking/fields/:id — удалить поле (только владелец)
  router.delete(
    '/fields/:id',
    authMiddleware(db),
    fieldOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const deleted = await api.deleteField(req.params.id);
        if (!deleted) {
          res.status(404).json({ error: 'Field not found' });
          return;
        }
        res.status(204).send();
      } catch (error) {
        if ((error as Error).message.includes('active bookings')) {
          res.status(409).json({ error: 'Cannot delete field with active bookings' });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    }
  );

  // ==================== SLOTS ====================

  // GET /booking/slots?field_id=&date= — слоты поля на дату (публичный)
  router.get('/slots', async (req: AuthRequest, res: Response) => {
    try {
      const { field_id, date } = req.query;
      if (!field_id || !date || typeof field_id !== 'string' || typeof date !== 'string') {
        res.status(400).json({ error: 'field_id and date query parameters required' });
        return;
      }
      if (!isValidUUID(field_id)) {
        res.status(400).json({ error: 'Invalid field_id format' });
        return;
      }
      const slots = await api.getSlotsByFieldAndDate(field_id, date);
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /booking/slots — создать слот (только владелец поля)
  router.post(
    '/slots',
    authMiddleware(db),
    fieldOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { field_id, date, start_time, end_time } = req.body;
        if (!field_id || !date || !start_time || !end_time) {
          res.status(400).json({ error: 'field_id, date, start_time, end_time are required' });
          return;
        }
        const slot = await api.createSlot({ field_id, date, start_time, end_time });
        res.status(201).json(slot);
      } catch (error) {
        if ((error as Error).message.includes('overlap')) {
          res.status(409).json({ error: 'Slot overlaps with existing slot' });
        } else {
          res.status(400).json({ error: (error as Error).message });
        }
      }
    }
  );

  // DELETE /booking/slots/:id — удалить слот (только владелец)
  router.delete(
    '/slots/:id',
    authMiddleware(db),
    slotOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const deleted = await api.deleteSlot(req.params.id);
        if (!deleted) {
          res.status(404).json({ error: 'Slot not found' });
          return;
        }
        res.status(204).send();
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  // POST /booking/slots/:id/block — заблокировать слот (только владелец)
  router.post(
    '/slots/:id/block',
    authMiddleware(db),
    slotOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { reason } = req.body;
        const slot = await api.blockSlot(req.params.id, reason);
        if (!slot) {
          res.status(404).json({ error: 'Slot not found' });
          return;
        }
        res.json(slot);
      } catch (error) {
        if ((error as Error).message.includes('pending booking')) {
          res.status(409).json({ error: 'Cannot block slot with pending booking' });
        } else {
          res.status(400).json({ error: (error as Error).message });
        }
      }
    }
  );

  // POST /booking/slots/:id/unblock — разблокировать слот (только владелец)
  router.post(
    '/slots/:id/unblock',
    authMiddleware(db),
    slotOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const slot = await api.unblockSlot(req.params.id);
        if (!slot) {
          res.status(404).json({ error: 'Slot not found' });
          return;
        }
        res.json(slot);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    }
  );

  // ==================== BOOKINGS ====================

  // GET /booking/my — мои бронирования (авторизованный пользователь)
  router.get('/my', authMiddleware(db), async (req: AuthRequest, res: Response) => {
    try {
      const bookings = await api.getMyBookings(req.userId!);
      res.json(bookings);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /booking?campaign_id= — бронирования площадки (только владелец campaign)
  router.get(
    '/',
    authMiddleware(db),
    campaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { campaign_id } = req.query;
        if (!campaign_id || typeof campaign_id !== 'string') {
          res.status(400).json({ error: 'campaign_id query parameter required' });
          return;
        }
        const bookings = await api.getBookingsByCampaign(campaign_id);
        res.json(bookings);
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  // POST /booking — создать бронь (авторизованный пользователь)
  router.post('/', authMiddleware(db), async (req: AuthRequest, res: Response) => {
    try {
      const { slot_id, comment } = req.body;
      if (!slot_id) {
        res.status(400).json({ error: 'slot_id is required' });
        return;
      }
      if (!isValidUUID(slot_id)) {
        res.status(400).json({ error: 'Invalid slot_id format' });
        return;
      }
      const booking = await api.createBooking(slot_id, req.userId!, comment);
      res.status(201).json(booking);
    } catch (error) {
      if ((error as Error).message === 'Slot already booked') {
        res.status(409).json({ error: 'Slot already booked' });
      } else if ((error as Error).message === 'Slot not found') {
        res.status(404).json({ error: 'Slot not found' });
      } else {
        res.status(400).json({ error: (error as Error).message });
      }
    }
  });

  // GET /booking/:id — получить детали брони (владелец брони)
  router.get('/:id', authMiddleware(db), async (req: AuthRequest, res: Response) => {
    try {
      if (!isValidUUID(req.params.id)) {
        res.status(400).json({ error: 'Invalid booking ID format' });
        return;
      }
      const booking = await api.getBookingDetailsById(req.params.id, req.userId!);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      res.json(booking);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /booking/:id — изменить статус брони (только владелец campaign)
  router.put(
    '/:id',
    authMiddleware(db),
    bookingCampaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { status } = req.body;
        if (!status) {
          res.status(400).json({ error: 'status is required' });
          return;
        }
        const validStatuses = ['pending', 'confirmed', 'rejected', 'cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'completed'];
        if (!validStatuses.includes(status)) {
          res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
          return;
        }
        const booking = await api.updateBookingStatus(req.params.id, status);
        if (!booking) {
          res.status(404).json({ error: 'Booking not found' });
          return;
        }
        res.json(booking);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /booking/:id — отменить бронь (только владелец брони)
  router.delete('/:id', authMiddleware(db), async (req: AuthRequest, res: Response) => {
    try {
      const cancelled = await api.cancelBooking(req.params.id, req.userId!);
      if (!cancelled) {
        res.status(404).json({ error: 'Booking not found or cannot be cancelled' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
