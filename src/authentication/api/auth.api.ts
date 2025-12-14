import { SupabaseClient } from '@supabase/supabase-js';
import { AuthRequest, AuthResponse, SignInRequest, SignInResponse, SignOutResponse, UserProfile, EMAIL_STATUS, ResetPasswordResponse, UpdatePasswordRequest, USER_ROLE } from '../model/auth.model';

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

    const emailVerified = data.user.email_confirmed_at ? EMAIL_STATUS.VERIFIED : EMAIL_STATUS.NOT_VERIFIED;

    return { 
      id: data.user.id,
      accessToken: data.session.access_token,
      email_verified: emailVerified
    };
  }

  async signUp(credentials: AuthRequest): Promise<SignInResponse & { accessToken: string }> {
    const emailRedirectTo = process.env.EMAIL_REDIRECT_URL || 'http://localhost:3000/confirm';
    
    const { data, error } = await this.supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: {
        emailRedirectTo: emailRedirectTo,
        data: {
          role: credentials.role,
          name: credentials.name,
          phone: credentials.phone,
          date_of_birth: credentials.date_of_birth
        }
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('User registration failed');
    }

    const emailVerified = data.user.email_confirmed_at ? EMAIL_STATUS.VERIFIED : EMAIL_STATUS.NOT_VERIFIED;

    return { 
      id: data.user.id,
      accessToken: data.session?.access_token || '',
      email_verified: emailVerified
    };
  }

  async confirmEmail(accessToken: string, refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { data, error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.session || !data.user) {
      throw new Error('Failed to create session');
    }

    // Создание записи в yclients_info для пользователей с ролью CAMPAIGN после подтверждения email
    if (data.user.user_metadata?.role === USER_ROLE.CAMPAIGN) {
      // Проверяем, существует ли уже запись
      const { data: existingData } = await this.supabase
        .from('yclients_info')
        .select('id')
        .eq('user_id', data.user.id)
        .single();

      // Создаем запись только если её еще нет
      if (!existingData) {
        const { error: ycError } = await this.supabase
          .from('yclients_info')
          .insert({
            user_id: data.user.id,
            yc_token: '',
            yc_user_id: ''
          });

        if (ycError) {
          console.error('Failed to create YClients info:', ycError.message);
          // Не бросаем ошибку, запись можно создать позже через отдельный эндпоинт
        }
      }
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
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

    const emailVerified = data.user.email_confirmed_at ? EMAIL_STATUS.VERIFIED : EMAIL_STATUS.NOT_VERIFIED;

    const profile: UserProfile = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.role,
      name: data.user.user_metadata?.name,
      phone: data.user.user_metadata?.phone,
      date_of_birth: data.user.user_metadata?.date_of_birth,
      email_verified: emailVerified,
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
        phone: updates.phone,
        date_of_birth: updates.date_of_birth
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('User not found');
    }

    const emailVerified = data.user.email_confirmed_at ? EMAIL_STATUS.VERIFIED : EMAIL_STATUS.NOT_VERIFIED;

    const profile: UserProfile = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.role,
      name: data.user.user_metadata?.name,
      phone: data.user.user_metadata?.phone,
      date_of_birth: data.user.user_metadata?.date_of_birth,
      email_verified: emailVerified,
      registration_date: data.user.created_at,
      created_at: data.user.created_at,
      updated_at: data.user.updated_at || data.user.created_at
    };

    return profile;
  }

  async requestPasswordReset(email: string): Promise<ResetPasswordResponse> {
    const redirectTo = process.env.PASSWORD_RESET_REDIRECT_URL || 'http://localhost:3000/new-password';
    
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo
    });

    if (error) {
      throw new Error(error.message);
    }

    return { message: 'Password reset email sent' };
  }

  async updatePassword(passwordData: UpdatePasswordRequest): Promise<{ message: string }> {
    if (passwordData.password !== passwordData.confirmPassword) {
      throw new Error('Passwords do not match');
    }

    const { error } = await this.supabase.auth.updateUser({
      password: passwordData.password
    });

    if (error) {
      throw new Error(error.message);
    }

    return { message: 'Password updated successfully' };
  }
}
