import { USER_ROLE } from './auth.model';

export interface DbInvitation {
  id: string;
  email: string;
  role: USER_ROLE;
  campaign_id: string | null;
  invited_by: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface InvitationDetails {
  id: string;
  email: string;
  role: USER_ROLE;
  campaign_id: string | null;
  campaign_name: string | null;
  invited_by_name: string | null;
  invite_link: string | null;
  status: 'PENDING' | 'USED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  is_owner: boolean;
  created_at: string;
}

export interface CreateInvitationRequest {
  email: string;
}

export interface AcceptInvitationRequest {
  token: string;
  password: string;
  name?: string;
  phone?: string;
  consent_personal_data?: boolean;
}

export interface ValidateTokenResponse {
  valid: boolean;
  expired?: boolean;
  email?: string;
  role?: USER_ROLE;
  campaign_name?: string;
  inviter_name?: string;
}

export const INVITATION_TTL_DAYS = 7;
