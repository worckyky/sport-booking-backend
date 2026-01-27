// === Fields (корты, залы) ===

export interface Field {
  id: string;
  campaign_id: string;
  name: string;
  price_per_hour: number | null;
  created_at: string;
}

export interface CreateFieldRequest {
  campaign_id: string;
  name: string;
  price_per_hour?: number;
}

export interface UpdateFieldRequest {
  name?: string;
  price_per_hour?: number;
}

// === Booking Slots (слоты времени) ===

export interface BookingSlot {
  id: string;
  field_id: string;
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:MM
  end_time: string;    // HH:MM
  created_at: string;
}

export interface CreateSlotRequest {
  field_id: string;
  date: string;
  start_time: string;
  end_time: string;
}

// === Bookings (бронирования) ===

export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed';

export interface Booking {
  id: string;
  slot_id: string;
  user_id: string;
  status: BookingStatus;
  created_at: string;
}

export interface CreateBookingRequest {
  slot_id: string;
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

export interface BookingDetails extends Booking {
  slot: BookingSlot;
  field: Field;
}
