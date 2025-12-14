export interface YClientsInfo {
  id: string;
  user_id: string;
  yc_partner_token: string;
  yc_user_token: string;
  created_at: string;
  updated_at: string;
}

export interface YClientsInfoResponse {
  ycPartnerToken: string;
  ycUserToken: string;
  yclientsCompanyId: string;
}

export interface UpdateYClientsInfoRequest {
  ycPartnerToken: string;
  ycLogin: string;
  ycPassword: string;
  yclientsCompanyId: string;
}

export interface YClientsAuthRequest {
  login: string;
  password: string;
}

export interface YClientsAuthSuccessResponse {
  success: true;
  data: {
    id: number;
    user_token: string;
    name: string;
    phone: string;
    login: string;
    email: string;
    avatar: string;
    is_approved: boolean;
    is_email_confirmed: boolean;
    0: string;
  };
  meta: unknown[];
}

export interface YClientsAuthErrorResponse {
  success: false;
  data: null;
  meta: {
    message: string;
  };
}

