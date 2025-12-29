import { SupabaseClient } from '@supabase/supabase-js';
import {
  Campaign,
  CampaignResponse,
  CreateCampaignRequest,
  UpdateCampaignRequest
} from '../model/campaign.model';

export class CampaignAPI {
  constructor(private supabase: SupabaseClient) {}

  async getCampaignById(campaignId: string): Promise<CampaignResponse> {
    const { data, error } = await this.supabase
      .from('campaign_info')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('Campaign not found');
    }

    return this.mapCampaignToResponse(data);
  }

  async getAllCampaigns(): Promise<CampaignResponse[]> {
    const { data, error } = await this.supabase
      .from('campaign_info')
      .select('*');

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map((campaign) => this.mapCampaignToResponse(campaign));
  }

  async createCampaign(
    userId: string,
    campaignData: CreateCampaignRequest
  ): Promise<CampaignResponse> {
    const requestData = campaignData as unknown as Record<string, unknown>;
    
    const { data, error } = await this.supabase
      .from('campaign_info')
      .insert({
        user_id: userId,
        name: campaignData.name,
        description: campaignData.description,
        short_description: campaignData.shortDescription || requestData.short_description || null,
        location: campaignData.location,
        contacts: campaignData.contacts,
        working_timetable: campaignData.workingTimetable || requestData.working_timetable,
        socials_links: campaignData.socialsLinks || requestData.socials_links || [],
        payment_methods: campaignData.paymentMethods || requestData.payment_methods || [],
        facilities: campaignData.facilities || [],
        sports: campaignData.sports || [],
        media: campaignData.media || {}
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('Failed to create campaign');
    }

    return this.mapCampaignToResponse(data);
  }

  async updateCampaign(
    campaignId: string,
    userId: string,
    campaignData: UpdateCampaignRequest
  ): Promise<CampaignResponse> {
    const updateData: Record<string, unknown> = {};
    const requestData = campaignData as unknown as Record<string, unknown>;

    if (campaignData.name !== undefined) updateData.name = campaignData.name;
    if (campaignData.description !== undefined) updateData.description = campaignData.description;
    
    if (campaignData.shortDescription !== undefined) {
      updateData.short_description = campaignData.shortDescription;
    } else if (requestData.short_description !== undefined) {
      updateData.short_description = requestData.short_description;
    }
    
    if (campaignData.location !== undefined) updateData.location = campaignData.location;
    if (campaignData.contacts !== undefined) updateData.contacts = campaignData.contacts;
    
    if (campaignData.workingTimetable !== undefined) {
      updateData.working_timetable = campaignData.workingTimetable;
    } else if (requestData.working_timetable !== undefined) {
      updateData.working_timetable = requestData.working_timetable;
    }
    
    if (campaignData.socialsLinks !== undefined) {
      updateData.socials_links = campaignData.socialsLinks;
    } else if (requestData.socials_links !== undefined) {
      updateData.socials_links = requestData.socials_links;
    }
    
    if (campaignData.paymentMethods !== undefined) {
      updateData.payment_methods = campaignData.paymentMethods;
    } else if (requestData.payment_methods !== undefined) {
      updateData.payment_methods = requestData.payment_methods;
    }
    
    if (campaignData.facilities !== undefined) updateData.facilities = campaignData.facilities;
    if (campaignData.sports !== undefined) updateData.sports = campaignData.sports;
    if (campaignData.media !== undefined) updateData.media = campaignData.media;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('campaign_info')
      .update(updateData)
      .eq('id', campaignId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('Campaign not found or not updated');
    }

    return this.mapCampaignToResponse(data);
  }

  async deleteCampaign(campaignId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('campaign_info')
      .delete()
      .eq('id', campaignId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  private mapCampaignToResponse(campaign: Campaign): CampaignResponse {
    return {
      id: campaign.id,
      userId: campaign.user_id,
      name: campaign.name,
      description: campaign.description,
      shortDescription: campaign.short_description,
      location: campaign.location,
      contacts: campaign.contacts,
      workingTimetable: campaign.working_timetable,
      socialsLinks: campaign.socials_links,
      paymentMethods: campaign.payment_methods,
      facilities: campaign.facilities,
      sports: campaign.sports,
      media: campaign.media,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at
    };
  }
}