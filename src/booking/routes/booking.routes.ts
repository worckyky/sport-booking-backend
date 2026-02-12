import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { BookingAPI, ScheduleConflictError } from '../api/booking.api';
import { authMiddleware, AuthRequest } from '../../authentication/middleware/auth.middleware';
import { adminMiddleware } from '../../authentication/middleware/admin.middleware';
import { AuditAPI, AUDIT_EVENTS } from '../../audit/audit.api';
import {
  fieldOwnerMiddleware,
  slotOwnerMiddleware,
  bookingCampaignOwnerMiddleware,
  campaignOwnerMiddleware,
  notBlockedMiddleware,
  activeBookingLimitMiddleware,
  userRoleMiddleware
} from '../middleware/booking.middleware';
import { campaignRoleMiddleware } from '../../campaign/middleware/campaign.middleware';
import { isValidUUID } from '../../utils/uuid';
import { Errors, ErrorCode, handleError, sendError } from '../../utils/errors';
import { validateSportTypes } from '../../utils/validators';

export default function createBookingRoutes(db: Pool): Router {
  const router = Router();
  const api = new BookingAPI(db);
  const auditAPI = new AuditAPI(db);

  // Per-user rate limit для создания бронирований (строже чем общий bookingLimiter)
  const createBookingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: process.env.NODE_ENV === 'production' ? 5 : 100,
    keyGenerator: (req: Request) => {
      // Извлекаем userId из JWT cookie для per-user лимита
      const token = req.cookies?.auth_token;
      if (token) {
        try {
          const decoded = jwt.decode(token) as { sub?: string } | null;
          if (decoded?.sub) return `create-booking:user:${decoded.sub}`;
        } catch {}
      }
      // Для IP используем ipKeyGenerator для поддержки IPv6
      const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
      return `create-booking:ip:${ipKeyGenerator(ip)}`;
    },
    message: {
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Слишком много попыток бронирования, подождите минуту' }
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ==================== FIELDS ====================

  // GET /booking/fields?campaign_id= — список полей площадки (публичный)
  router.get('/fields', async (req: AuthRequest, res: Response) => {
    try {
      const { campaign_id } = req.query;
      if (!campaign_id || typeof campaign_id !== 'string') {
        return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'campaign_id query parameter required', 'campaign_id');
      }
      if (!isValidUUID(campaign_id)) {
        return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid campaign_id format', 'campaign_id');
      }
      const fields = await api.getFieldsByCampaign(campaign_id);
      res.json(fields);
    } catch (error) {
      Errors.internal(res);
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

  // GET /booking/fields/:id/active-bookings — активные брони поля (только владелец)
  router.get(
    '/fields/:id/active-bookings',
    authMiddleware(db),
    fieldOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isValidUUID(req.params.id)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid field ID format', 'id');
        }
        const bookings = await api.getActiveBookingsForField(req.params.id);
        res.json(bookings);
      } catch (error) {
        Errors.internal(res);
      }
    }
  );

  // POST /booking/fields — создать поле (только владелец campaign)
  router.post(
    '/fields',
    authMiddleware(db),
    campaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const {
          campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
          slot_duration, working_hours_from, working_hours_to, working_days, working_timetable, client_info
        } = req.body;

        // Валидация обязательных полей
        if (!campaign_id || !name) {
          res.status(400).json({ error: 'campaign_id and name are required' });
          return;
        }
        const sportErr = validateSportTypes(sport_types);
        if (sportErr) {
          res.status(400).json({ error: sportErr });
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
        if (typeof price_per_hour !== 'number' || price_per_hour <= 0 || price_per_hour > 100000) {
          res.status(400).json({ error: 'price_per_hour must be between 1 and 100000' });
          return;
        }
        if (slot_duration !== undefined && (typeof slot_duration !== 'number' || slot_duration < 15 || slot_duration > 480)) {
          res.status(400).json({ error: 'slot_duration must be between 15 and 480 minutes' });
          return;
        }

        // Проверка лимита полей на площадку (VAL-08)
        const existingFields = await api.getFieldsByCampaign(campaign_id);
        if (existingFields.length >= 50) {
          res.status(400).json({ error: 'Maximum 50 fields per campaign' });
          return;
        }

        const field = await api.createField({
          campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
          slot_duration, working_hours_from, working_hours_to, working_days, working_timetable, client_info
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
          slot_duration, working_hours_from, working_hours_to, working_days, working_timetable, client_info
        } = req.body;

        // Валидация sport_types если передан
        if (sport_types !== undefined) {
          const sportErr = validateSportTypes(sport_types);
          if (sportErr) {
            res.status(400).json({ error: sportErr });
            return;
          }
        }

        // Валидация price_per_hour если передан
        if (price_per_hour !== undefined && (typeof price_per_hour !== 'number' || price_per_hour <= 0 || price_per_hour > 100000)) {
          res.status(400).json({ error: 'price_per_hour must be between 1 and 100000' });
          return;
        }

        // Валидация slot_duration если передан
        if (slot_duration !== undefined && (typeof slot_duration !== 'number' || slot_duration < 15 || slot_duration > 480)) {
          res.status(400).json({ error: 'slot_duration must be between 15 and 480 minutes' });
          return;
        }

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
          slot_duration, working_hours_from, working_hours_to, working_days, working_timetable, client_info
        });
        if (!field) {
          res.status(404).json({ error: 'Field not found' });
          return;
        }
        res.json(field);
      } catch (error) {
        if (error instanceof ScheduleConflictError) {
          res.status(409).json({
            error: error.message,
            code: error.code,
            conflicts: error.conflicts,
          });
        } else {
          res.status(400).json({ error: (error as Error).message });
        }
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
        const msg = (error as Error).message;
        if (msg.includes('active bookings')) {
          res.status(409).json({ error: 'Cannot delete field with active bookings' });
        } else if (msg.includes('last field')) {
          res.status(400).json({ error: msg });
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

  // GET /booking/calendar-data?campaign_id=&date= — консолидированные данные для календаря
  router.get(
    '/calendar-data',
    authMiddleware(db),
    campaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { campaign_id, date } = req.query;
        if (!campaign_id || typeof campaign_id !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'campaign_id query parameter required', 'campaign_id');
        }
        if (!isValidUUID(campaign_id)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid campaign_id format', 'campaign_id');
        }
        if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'date must be in YYYY-MM-DD format', 'date');
        }
        const data = await api.getCalendarData(campaign_id, date);
        res.json(data);
      } catch (error) {
        const msg = (error as Error).message;
        if (msg === 'Campaign not found') {
          return sendError(res, 404, ErrorCode.NOT_FOUND, 'Campaign not found', 'campaign_id');
        }
        Errors.internal(res);
      }
    }
  );

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
        if ((error as Error).message.includes('active booking')) {
          res.status(409).json({ error: 'Cannot block slot with active booking' });
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

  // ==================== STATS ====================

  // GET /booking/stats?campaign_id= — агрегированная статистика площадки (только владелец campaign)
  router.get(
    '/stats',
    authMiddleware(db),
    campaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { campaign_id } = req.query;
        if (!campaign_id || typeof campaign_id !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'campaign_id query parameter required', 'campaign_id');
        }
        if (!isValidUUID(campaign_id)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid campaign_id format', 'campaign_id');
        }
        // Get timezone from campaign
        const tzResult = await db.query(
          'SELECT timezone_id FROM campaign_info WHERE id = $1',
          [campaign_id]
        );
        const timezoneId = tzResult.rows[0]?.timezone_id || 'Europe/Moscow';

        const stats = await api.getCampaignStats(campaign_id, timezoneId);
        res.json(stats);
      } catch (error) {
        Errors.internal(res);
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

  // GET /booking?campaign_id=&page=&limit= — бронирования площадки (только владелец campaign)
  router.get(
    '/',
    authMiddleware(db),
    campaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { campaign_id, page, limit } = req.query;
        if (!campaign_id || typeof campaign_id !== 'string') {
          res.status(400).json({ error: 'campaign_id query parameter required' });
          return;
        }
        const pagination = {
          page: page ? parseInt(page as string, 10) : undefined,
          limit: limit ? parseInt(limit as string, 10) : undefined,
        };
        const result = await api.getBookingsByCampaign(campaign_id, pagination);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  // POST /booking — создать бронь (авторизованный пользователь, не заблокированный, не превышен лимит)
  router.post('/', createBookingLimiter, authMiddleware(db), userRoleMiddleware(db), notBlockedMiddleware(db), activeBookingLimitMiddleware(db, 10), async (req: AuthRequest, res: Response) => {
    try {
      const { slot_id, comment, contact_name, contact_phone } = req.body;
      if (!slot_id) {
        return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'slot_id is required', 'slot_id');
      }
      if (!isValidUUID(slot_id)) {
        return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid slot_id format', 'slot_id');
      }
      const booking = await api.createBooking(slot_id, req.userId!, comment, contact_name, contact_phone);
      res.status(201).json(booking);
    } catch (error) {
      handleError(res, error);
    }
  });

  // POST /booking/admin — создать бронь вручную (только владелец campaign)
  // Бронь создаётся сразу со статусом confirmed
  router.post(
    '/admin',
    authMiddleware(db),
    campaignRoleMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { slot_id, contact_name, contact_phone, comment } = req.body;

        if (!slot_id) {
          res.status(400).json({ error: 'slot_id is required' });
          return;
        }
        if (!isValidUUID(slot_id)) {
          res.status(400).json({ error: 'Invalid slot_id format' });
          return;
        }
        if (!contact_phone) {
          res.status(400).json({ error: 'contact_phone is required' });
          return;
        }

        // Проверяем что пользователь - владелец кампании этого слота
        const campaignId = await api.getCampaignIdBySlotId(slot_id);
        if (!campaignId) {
          res.status(404).json({ error: 'Slot not found' });
          return;
        }

        // Проверяем владельца
        const campaignOwner = await db.query(
          'SELECT user_id FROM campaign_info WHERE id = $1',
          [campaignId]
        );
        if (campaignOwner.rows[0]?.user_id !== req.userId) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }

        const booking = await api.createAdminBooking(slot_id, contact_name, contact_phone, comment);
        res.status(201).json(booking);
      } catch (error) {
        handleError(res, error);
      }
    }
  );

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
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'status is required', 'status');
        }
        const validStatuses = ['pending', 'confirmed', 'completed', 'no_show', 'rejected', 'expired', 'cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin'];
        if (!validStatuses.includes(status)) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, 'status');
        }
        const booking = await api.updateBookingStatus(req.params.id, status);
        if (!booking) {
          return Errors.notFound(res, 'Booking');
        }
        res.json(booking);
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  // PUT /booking/:id/reschedule — перенести бронь на другой слот (только владелец campaign)
  router.put(
    '/:id/reschedule',
    authMiddleware(db),
    bookingCampaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { new_slot_id, reason } = req.body;
        if (!new_slot_id) {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'new_slot_id is required', 'new_slot_id');
        }
        if (!isValidUUID(new_slot_id)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid new_slot_id format', 'new_slot_id');
        }
        const booking = await api.rescheduleBooking(req.params.id, new_slot_id, req.userId!, reason);
        if (!booking) {
          return Errors.notFound(res, 'Booking');
        }
        res.json(booking);
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  // GET /booking/:id/reschedules — история переносов брони
  router.get(
    '/:id/reschedules',
    authMiddleware(db),
    bookingCampaignOwnerMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const history = await api.getBookingRescheduleHistory(req.params.id);
        res.json(history);
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  // GET /booking/admin/:id — получить бронь по ID (только для ADMIN)
  router.get('/admin/:id', adminMiddleware(db), async (req: AuthRequest, res: Response) => {
    try {
      const bookingId = req.params.id;
      if (!isValidUUID(bookingId)) {
        return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'Invalid booking ID format', 'id');
      }

      const booking = await api.getBookingByIdAdmin(bookingId);
      if (!booking) {
        return sendError(res, 404, ErrorCode.NOT_FOUND, 'Booking not found', 'id');
      }

      res.json(booking);
    } catch (error) {
      handleError(res, error);
    }
  });

  // PUT /booking/admin/bulk-status — массовое обновление статусов (только для ADMIN)
  router.put('/admin/bulk-status', adminMiddleware(db), async (req: AuthRequest, res: Response) => {
    try {
      const { bookingIds, status } = req.body;

      if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
        return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bookingIds array is required', 'bookingIds');
      }

      if (bookingIds.length > 100) {
        return sendError(res, 400, ErrorCode.VALIDATION_ERROR, 'Maximum 100 bookings per request', 'bookingIds');
      }

      if (!status) {
        return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'status is required', 'status');
      }

      const validStatuses = ['confirmed', 'rejected', 'cancelled_by_admin'];
      if (!validStatuses.includes(status)) {
        return sendError(res, 400, ErrorCode.VALIDATION_ERROR, `Invalid status for bulk update. Must be one of: ${validStatuses.join(', ')}`, 'status');
      }

      // Валидация UUID
      for (const id of bookingIds) {
        if (!isValidUUID(id)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, `Invalid booking ID format: ${id}`, 'bookingIds');
        }
      }

      const result = await api.bulkUpdateBookingStatus(bookingIds, status);
      const eventMap: Record<string, string> = {
        confirmed: AUDIT_EVENTS.BOOKING_BULK_CONFIRMED,
        rejected: AUDIT_EVENTS.BOOKING_BULK_REJECTED,
        cancelled_by_admin: AUDIT_EVENTS.BOOKING_BULK_CANCELLED,
      };
      auditAPI.log({
        eventType: eventMap[status] || `booking.bulk_${status}`,
        actorId: req.userId!,
        resourceType: 'booking',
        metadata: { count: result.updated, bookingIds },
      }).catch(() => {});
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });

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
