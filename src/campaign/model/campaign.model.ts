export enum CampaignStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PUBLISHED = 'published',
  SUSPENDED = 'suspended'
}

export enum SocialLinkType {
  VK = 'VK',
  TELEGRAM = 'TELEGRAM',
  WHATS_APP = 'WHATS_APP'
}

export enum PaymentMethod {
  MONEY = 'MONEY',
  CARD = 'CARD',
  SBP = 'SBP'
}

// Sport types and Facilities are now managed as dynamic dictionaries in DB
// (tables: sport_types, facilities) — see migration 028

export interface Location {
  city: string;
  street: string;
  house: string;
  coordinates: string;
}

export interface Contacts {
  phone: string;
  email: string;
  site: string;
}

export interface TimeSlot {
  from: string;
  to: string;
  isWeekend: boolean;
}

export interface WorkingTimetable {
  monday: TimeSlot;
  tuesday: TimeSlot;
  wednesday: TimeSlot;
  thursday: TimeSlot;
  friday: TimeSlot;
  saturday: TimeSlot;
  sunday: TimeSlot;
}

export interface SocialLink {
  link_type: SocialLinkType;
  link: string;
}

export interface ExtraMedia {
  src: string;
  description: string;
}

export interface Media {
  main_src: string;
  description: string;
  extra_media: ExtraMedia[];
}

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  short_description: string | null;
  location: Location | null;
  contacts: Contacts | null;
  working_timetable: WorkingTimetable | null;
  socials_links: SocialLink[] | null;
  payment_methods: PaymentMethod[] | null;
  facilities: string[] | null;
  media: Media | null;
  booking_info: string | null;
  timezone_id: string;
  status: CampaignStatus;
  pending_changes: Record<string, unknown> | null;
  moderation_comment: string | null;
  moderation_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignResponse {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  shortDescription: string | null;
  location: Location | null;
  contacts: Contacts | null;
  workingTimetable: WorkingTimetable | null;
  socialsLinks: SocialLink[] | null;
  paymentMethods: PaymentMethod[] | null;
  facilities: string[] | null;
  sports: string[] | null;
  media: Media | null;
  bookingInfo: string | null;
  timezoneId: string;
  status: CampaignStatus;
  pendingChanges: Record<string, unknown> | null;
  moderationComment: string | null;
  moderationAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCampaignResponse extends CampaignResponse {
  ownerName: string | null;
  ownerEmail: string | null;
  ownerId: string | null;
  fieldsCount: number;
  bookingsCount: number;
}

export interface ReadinessItem {
  key: string;
  label: string;
  done: boolean;
}

export interface ReadinessResponse {
  ready: boolean;
  items: ReadinessItem[];
  missingCount: number;
}

export interface CreateCampaignRequest {
  name: string;
  description: string;
  shortDescription?: string;
  location: Location;
  contacts: Contacts;
  workingTimetable: WorkingTimetable;
  socialsLinks?: SocialLink[];
  paymentMethods?: PaymentMethod[];
  facilities?: string[];
  media?: Media;
  bookingInfo?: string;
  timezoneId?: string;
}

export interface UpdateCampaignRequest {
  name?: string;
  description?: string;
  shortDescription?: string;
  location?: Location;
  contacts?: Contacts;
  workingTimetable?: WorkingTimetable;
  socialsLinks?: SocialLink[];
  paymentMethods?: PaymentMethod[];
  facilities?: string[];
  media?: Media;
  bookingInfo?: string;
  timezoneId?: string;
}