import type { Pool } from 'pg';

export interface AuditEvent {
  eventType: string;
  actorId: string;
  actorEmail?: string;
  resourceType?: string;
  resourceId?: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  metadata?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  event_type: string;
  actor_id: string;
  actor_email: string | null;
  resource_type: string | null;
  resource_id: string | null;
  changes: Record<string, { from?: unknown; to?: unknown }> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// Event type constants
export const AUDIT_EVENTS = {
  USER_BLOCKED: 'user.blocked',
  USER_UNBLOCKED: 'user.unblocked',
  CAMPAIGN_PUBLISHED: 'campaign.published',
  CAMPAIGN_REJECTED: 'campaign.rejected',
  CAMPAIGN_SUSPENDED: 'campaign.suspended',
  BOOKING_BULK_CONFIRMED: 'booking.bulk_confirmed',
  BOOKING_BULK_REJECTED: 'booking.bulk_rejected',
  BOOKING_BULK_CANCELLED: 'booking.bulk_cancelled',
  TEAM_INVITED: 'team.invited',
  TEAM_REMOVED: 'team.removed',
  REGISTRATION_LINK_CREATED: 'registration_link.created',
  SETTINGS_UPDATED: 'settings.updated',
} as const;

export class AuditAPI {
  constructor(private db: Pool) {}

  async log(event: AuditEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO admin_audit_log (event_type, actor_id, actor_email, resource_type, resource_id, changes, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.eventType,
        event.actorId,
        event.actorEmail || null,
        event.resourceType || null,
        event.resourceId || null,
        event.changes ? JSON.stringify(event.changes) : null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ]
    );
  }

  async getActivity(options: {
    limit?: number;
    offset?: number;
    eventType?: string;
    resourceType?: string;
    actorId?: string;
  } = {}): Promise<{ items: AuditLogEntry[]; total: number }> {
    const { limit = 50, offset = 0, eventType, resourceType, actorId } = options;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (eventType) {
      conditions.push(`event_type = $${paramIdx++}`);
      params.push(eventType);
    }
    if (resourceType) {
      conditions.push(`resource_type = $${paramIdx++}`);
      params.push(resourceType);
    }
    if (actorId) {
      conditions.push(`actor_id = $${paramIdx++}`);
      params.push(actorId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [itemsResult, countResult] = await Promise.all([
      this.db.query<AuditLogEntry>(
        `SELECT * FROM admin_audit_log ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM admin_audit_log ${where}`,
        params
      ),
    ]);

    return {
      items: itemsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async getRecentActivity(limit = 10): Promise<AuditLogEntry[]> {
    const result = await this.db.query<AuditLogEntry>(
      `SELECT * FROM admin_audit_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}
