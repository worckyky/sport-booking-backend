export enum USER_ROLE {
  USER = 'USER',
  CAMPAIGN = 'CAMPAIGN',
  ADMIN = 'ADMIN'
}

export interface AuthRequest {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  role?: USER_ROLE;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface SignInResponse {
  id: string;
}

export interface UserProfile {
  id: string;
  role: USER_ROLE;
  name?: string;
  registration_date?: string;
  phone?: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  user: any | null;
  session: any | null;
}

export interface SignOutResponse {
  message: string;
}

export interface AuthError {
  error: string;
}
