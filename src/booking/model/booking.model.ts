// === Fields (корты, залы) ===

export type FieldStatus = 'active' | 'disabled' | 'hidden';

export interface Field {
  id: string;
  campaign_id: string;
  name: string;
  sport_types: string[];
  is_indoor: boolean;
  photos: string[];
  price_per_hour: number;
  status: FieldStatus;
  slot_duration: number;
  working_hours_from: string | null;
  working_hours_to: string | null;
  working_days: string[];
  client_info: string | null;
  created_at: string;
}

export interface CreateFieldRequest {
  campaign_id: string;
  name: string;
  sport_types: string[];
  is_indoor: boolean;
  photos: string[];
  price_per_hour: number;
  slot_duration?: number;
  working_hours_from?: string;
  working_hours_to?: string;
  working_days?: string[];
  client_info?: string;
}

export interface UpdateFieldRequest {
  name?: string;
  sport_types?: string[];
  is_indoor?: boolean;
  photos?: string[];
  price_per_hour?: number;
  status?: FieldStatus;
  slot_duration?: number;
  working_hours_from?: string | null;
  working_hours_to?: string | null;
  working_days?: string[];
  client_info?: string | null;
}

// === Booking Slots (слоты времени) ===

export interface BookingSlot {
  id: string;
  field_id: string;
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:MM
  end_time: string;    // HH:MM
  is_blocked: boolean;
  block_reason: string | null;
  created_at: string;
}

export interface CreateSlotRequest {
  field_id: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface BlockSlotRequest {
  reason?: string;
}

// === Bookings (бронирования) ===

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'cancelled_by_client'
  | 'cancelled_by_facility'
  | 'cancelled_by_admin'
  | 'completed';

export interface Booking {
  id: string;
  slot_id: string;
  user_id: string;
  status: BookingStatus;
  comment: string | null;
  created_at: string;
}

export interface CreateBookingRequest {
  slot_id: string;
  comment?: string;
}

export interface UpdateBookingRequest {
  status: BookingStatus;
}

// === Response types (с JOIN данными) ===

export interface SlotWithBooking extends BookingSlot {
  booking: {
    id: string;
    user_id: string;
    status: BookingStatus;
  } | null;
}

export interface BookingUser {
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface BookingDetails extends Booking {
  slot: BookingSlot;
  field: Field;
  user?: BookingUser;
}
