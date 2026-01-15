import crypto from 'crypto';
import type { Pool } from 'pg';
import {
  Campaign,
  CampaignResponse,
  CreateCampaignRequest,
  UpdateCampaignRequest
} from '../model/campaign.model';
import { normalizeEnumArray, normalizeJsonArray, toJsonbValue } from '../../utils/pg';

export class CampaignAPI {
  constructor(private db: Pool) {}

  async getCampaignById(campaignId: string): Promise<CampaignResponse> {
    const { rows } = await this.db.query<Campaign>(
      'select * from campaign_info where id = $1 limit 1',
      [campaignId]
    );
    const data = rows[0];
    if (!data) {
      throw new Error('Campaign not found');
    }

    return this.mapCampaignToResponse(data);
  }

  async getAllCampaigns(): Promise<CampaignResponse[]> {
    const { rows } = await this.db.query<Campaign>('select * from campaign_info');
    return rows.map((campaign) => this.mapCampaignToResponse(campaign));
  }

  async createCampaign(
    userId: string,
    campaignData: CreateCampaignRequest
  ): Promise<CampaignResponse> {
    const requestData = campaignData as unknown as Record<string, unknown>;

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const insert = await this.db.query<Campaign>(
      `
        insert into campaign_info (
          id,
          user_id,
          name,
          description,
          short_description,
          location,
          contacts,
          working_timetable,
          socials_links,
          payment_methods,
          facilities,
          sports,
          media,
          created_at,
          updated_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        returning *
      `,
      [
        id,
        userId,
        campaignData.name,
        campaignData.description,
        campaignData.shortDescription || requestData.short_description || null,
        toJsonbValue(campaignData.location),
        toJsonbValue(campaignData.contacts),
        toJsonbValue(campaignData.workingTimetable || requestData.working_timetable || null),
        toJsonbValue(campaignData.socialsLinks || requestData.socials_links || null),
        campaignData.paymentMethods || requestData.payment_methods || null,
        campaignData.facilities ?? null,
        campaignData.sports ?? null,
        toJsonbValue(campaignData.media ?? null),
        now,
        now
      ]
    );

    const created = insert.rows[0];
    if (!created) throw new Error('Failed to create campaign');

    return this.mapCampaignToResponse(created);
  }

  async updateCampaign(
    campaignId: string,
    userId: string,
    campaignData: UpdateCampaignRequest
  ): Promise<CampaignResponse> {
    const requestData = campaignData as unknown as Record<string, unknown>;

    const setParts: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const add = (col: string, val: unknown): void => {
      setParts.push(`${col} = $${i}`);
      values.push(val);
      i += 1;
    };

    if (campaignData.name !== undefined) add('name', campaignData.name);
    if (campaignData.description !== undefined) add('description', campaignData.description);

    if (campaignData.shortDescription !== undefined) {
      add('short_description', campaignData.shortDescription);
    } else if (requestData.short_description !== undefined) {
      add('short_description', requestData.short_description);
    }

    if (campaignData.location !== undefined) add('location', toJsonbValue(campaignData.location));
    if (campaignData.contacts !== undefined) add('contacts', toJsonbValue(campaignData.contacts));

    if (campaignData.workingTimetable !== undefined) {
      add('working_timetable', toJsonbValue(campaignData.workingTimetable));
    } else if (requestData.working_timetable !== undefined) {
      add('working_timetable', toJsonbValue(requestData.working_timetable));
    }

    if (campaignData.socialsLinks !== undefined) {
      add('socials_links', toJsonbValue(campaignData.socialsLinks));
    } else if (requestData.socials_links !== undefined) {
      add('socials_links', toJsonbValue(requestData.socials_links));
    }

    if (campaignData.paymentMethods !== undefined) {
      add('payment_methods', campaignData.paymentMethods);
    } else if (requestData.payment_methods !== undefined) {
      add('payment_methods', requestData.payment_methods);
    }

    if (campaignData.facilities !== undefined) add('facilities', campaignData.facilities);
    if (campaignData.sports !== undefined) add('sports', campaignData.sports);
    if (campaignData.media !== undefined) add('media', toJsonbValue(campaignData.media));

    add('updated_at', new Date().toISOString());

    if (setParts.length === 0) {
      throw new Error('Campaign not found or not updated');
    }

    values.push(campaignId, userId);

    const updated = await this.db.query<Campaign>(
      `
        update campaign_info
        set ${setParts.join(', ')}
        where id = $${i} and user_id = $${i + 1}
        returning *
      `,
      values
    );

    if (updated.rowCount === 0) throw new Error('Campaign not found or not updated');
    return this.mapCampaignToResponse(updated.rows[0]);
  }

  async deleteCampaign(campaignId: string, userId: string): Promise<void> {
    const result = await this.db.query('delete from campaign_info where id = $1 and user_id = $2', [
      campaignId,
      userId
    ]);

    if (result.rowCount === 0) {
      throw new Error('Campaign not found or not deleted');
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
      socialsLinks: normalizeJsonArray(campaign.socials_links),
      paymentMethods: normalizeEnumArray(campaign.payment_methods),
      facilities: normalizeEnumArray(campaign.facilities),
      sports: normalizeEnumArray(campaign.sports),
      media: campaign.media,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at
    };
  }
}