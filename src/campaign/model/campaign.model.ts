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
  WIFI = 'WIFI',
  LIGHTING = 'LIGHTING',
  AIR_CONDITIONING = 'AIR_CONDITIONING',
  CAFE = 'CAFE',
  RENTAL = 'RENTAL',
  VIDEO_SURVEILLANCE = 'VIDEO_SURVEILLANCE'
}

export enum Sport {
  FOOTBALL = 'FOOTBALL',
  BASKETBALL = 'BASKETBALL',
  TENNIS = 'TENNIS',
  VOLLEYBALL = 'VOLLEYBALL'
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
  sports: Sport[] | null;
  media: Media | null;
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
  sports?: Sport[];
  media?: Media;
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
  sports?: Sport[];
  media?: Media;
}