export interface DbRegistrationLink {
  id: string;
  token_hash: string;
  created_by: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface RegistrationLinkDetails {
  id: string;
  link: string | null;
  created_by_name: string | null;
  used_by_email: string | null;
  status: 'ACTIVE' | 'USED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
}

export interface AcceptRegistrationRequest {
  token: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  consent_personal_data?: boolean;
}

export const REGISTRATION_LINK_TTL_DAYS = 7;
