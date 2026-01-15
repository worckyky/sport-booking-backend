import { EMAIL_STATUS, USER_ROLE } from './auth.model';

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  role: USER_ROLE;
  name: string | null;
  phone: string | null;
  date_of_birth: string | null;
  email_verified: EMAIL_STATUS;
  campaign_id: string | null;
  created_at: string;
  updated_at: string;
}

export function getEmailStatus(user: Pick<DbUser, 'email_verified'>): EMAIL_STATUS {
  return user.email_verified;
}

