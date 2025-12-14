import { SupabaseClient } from '@supabase/supabase-js';
import {
  YClientsInfo,
  YClientsInfoResponse,
  UpdateYClientsInfoRequest,
  YClientsAuthRequest,
  YClientsAuthSuccessResponse,
  YClientsAuthErrorResponse
} from '../model/yclients.model';

export class YClientsAPI {
  constructor(private supabase: SupabaseClient) {}

  async getYClientsInfo(userId: string): Promise<YClientsInfoResponse> {
    let { data, error } = await this.supabase
      .from('yclients_info')
      .select('yc_partner_token, yc_user_token, yclients_company_id')
      .eq('user_id', userId)
      .single();

    // Если записи нет, создаем её автоматически
    if (error && error.code === 'PGRST116') {
      const { error: insertError } = await this.supabase
        .from('yclients_info')
        .insert({
          user_id: userId,
          yc_partner_token: '',
          yc_user_token: '',
          yclients_company_id: ''
        });

      if (insertError) {
        throw new Error(`Failed to create YClients info: ${insertError.message}`);
      }

      // Получаем созданную запись
      const result = await this.supabase
        .from('yclients_info')
        .select('yc_partner_token, yc_user_token, yclients_company_id')
        .eq('user_id', userId)
        .single();

      data = result.data;
      error = result.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('YClients info not found');
    }

    return {
      ycPartnerToken: data.yc_partner_token,
      ycUserToken: data.yc_user_token,
      yclientsCompanyId: data.yclients_company_id
    };
  }

  async updateYClientsInfo(
    userId: string,
    updates: UpdateYClientsInfoRequest
  ): Promise<YClientsInfoResponse> {
    // Запрос к YClients API для получения user_token
    const authRequest: YClientsAuthRequest = {
      login: updates.ycLogin,
      password: updates.ycPassword
    };

    let ycUserToken: string;

    try {
      const response = await fetch('https://api.yclients.com/api/v1/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.api.v2+json',
          'Authorization': `Bearer ${updates.ycPartnerToken}`
        },
        body: JSON.stringify(authRequest)
      });

      const result = (await response.json()) as
        | YClientsAuthSuccessResponse
        | YClientsAuthErrorResponse;

      if (!result.success) {
        throw new Error(result.meta.message);
      }

      ycUserToken = result.data.user_token;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to authenticate with YClients');
    }

    // Используем upsert для создания/обновления записи в БД
    const { data, error } = await this.supabase
      .from('yclients_info')
      .upsert(
        {
          user_id: userId,
          yc_partner_token: updates.ycPartnerToken,
          yc_user_token: ycUserToken,
          yclients_company_id: updates.yclientsCompanyId
        },
        {
          onConflict: 'user_id'
        }
      )
      .select('yc_partner_token, yc_user_token, yclients_company_id')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('YClients info not found');
    }

    return {
      ycPartnerToken: data.yc_partner_token,
      ycUserToken: data.yc_user_token,
      yclientsCompanyId: data.yclients_company_id
    };
  }
}

