export enum USER_ROLE {
  USER = 'USER',
  CAMPAIGN = 'CAMPAIGN',
  ADMIN = 'ADMIN'
}

export enum EMAIL_STATUS {
  VERIFIED = 'VERIFIED',
  NOT_VERIFIED = 'NOT_VERIFIED'
}


export interface AuthRequest {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  role?: USER_ROLE;
  date_of_birth?: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface SignInResponse {
  id: string;
  email_verified: EMAIL_STATUS;
}



export interface UserProfile {
  id: string;
  role: USER_ROLE;
  name?: string;
  registration_date?: string;
  phone?: string;
  email?: string;
  email_verified: EMAIL_STATUS;
  date_of_birth?: string;
  campaign_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  user: unknown | null;
  session: unknown | null;
}

export interface SignOutResponse {
  message: string;
}

export interface AuthError {
  error: string;
}

export interface ResetPasswordRequest {
  email: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface UpdatePasswordRequest {
  password: string;
  confirmPassword: string;
}

export interface UpdatePasswordWithTokenRequest {
  password: string;
  confirmPassword: string;
  access_token: string;
  refresh_token?: string;
}
