import { SupabaseClient } from '@supabase/supabase-js';
import { AuthRequest, AuthResponse, SignInRequest, SignInResponse, SignOutResponse, UserProfile } from '../model/auth.model';

export class AuthAPI {
  constructor(private supabase: SupabaseClient) {}

  async signIn(credentials: SignInRequest): Promise<SignInResponse & { accessToken: string }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user || !data.session) {
      throw new Error('User not found');
    }

    return { 
      id: data.user.id,
      accessToken: data.session.access_token
    };
  }

  async signUp(credentials: AuthRequest): Promise<SignInResponse & { accessToken: string }> {
    const { data, error } = await this.supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: {
        data: {
          role: credentials.role,
          name: credentials.name,
          phone: credentials.phone
        }
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user || !data.session) {
      throw new Error('User registration failed');
    }

    return { 
      id: data.user.id,
      accessToken: data.session.access_token
    };
  }

  async signOut(): Promise<SignOutResponse> {
    const { error } = await this.supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }

    return { message: 'Signed out successfully' };
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.supabase.auth.admin.getUserById(userId);

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user) {
      return null;
    }

    const profile: UserProfile = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.role,
      name: data.user.user_metadata?.name,
      phone: data.user.user_metadata?.phone,
      registration_date: data.user.created_at,
      created_at: data.user.created_at,
      updated_at: data.user.updated_at || data.user.created_at
    };

    return profile;
  }

  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
    const { data, error } = await this.supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        role: updates.role,
        name: updates.name,
        phone: updates.phone
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('User not found');
    }

    const profile: UserProfile = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.role,
      name: data.user.user_metadata?.name,
      phone: data.user.user_metadata?.phone,
      registration_date: data.user.created_at,
      created_at: data.user.created_at,
      updated_at: data.user.updated_at || data.user.created_at
    };

    return profile;
  }
}
