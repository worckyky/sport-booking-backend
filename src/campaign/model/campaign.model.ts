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

export enum Facility {
  PARKING = 'PARKING',
  SHOWER = 'SHOWER',
  LOCKER_ROOM = 'LOCKER_ROOM',
  STORAGE = 'STORAGE',
  WIFI = 'WIFI',
  LIGHTING = 'LIGHTING',
  STANDS = 'STANDS',
  MUSIC = 'MUSIC',
  AIR_CONDITIONING = 'AIR_CONDITIONING',
  HEATING = 'HEATING',
  CAFE = 'CAFE',
  RENTAL = 'RENTAL',
  TRAINERS = 'TRAINERS',
  RESTROOM = 'RESTROOM',
  VIDEO_SURVEILLANCE = 'VIDEO_SURVEILLANCE'
}

export enum Sport {
  FOOTBALL = 'FOOTBALL',
  MINI_FOOTBALL = 'MINI_FOOTBALL',
  BASKETBALL = 'BASKETBALL',
  VOLLEYBALL = 'VOLLEYBALL',
  TENNIS = 'TENNIS',
  TABLE_TENNIS = 'TABLE_TENNIS',
  BADMINTON = 'BADMINTON',
  SQUASH = 'SQUASH',
  PADEL = 'PADEL',
  HOCKEY = 'HOCKEY',
  FITNESS = 'FITNESS',
  YOGA = 'YOGA',
  SWIMMING = 'SWIMMING',
  MARTIAL_ARTS = 'MARTIAL_ARTS',
  OTHER = 'OTHER'
}

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
  facilities: Facility[] | null;
  media: Media | null;
  booking_info: string | null;
  timezone_id: string;
  status: CampaignStatus;
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
  facilities: Facility[] | null;
  sports: Sport[] | null;
  media: Media | null;
  bookingInfo: string | null;
  timezoneId: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
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
  facilities?: Facility[];
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
  facilities?: Facility[];
  media?: Media;
  bookingInfo?: string;
  timezoneId?: string;
}