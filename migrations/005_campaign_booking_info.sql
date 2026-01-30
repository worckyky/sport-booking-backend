-- Add booking_info field to campaign_info table
-- Information displayed to client after booking confirmation

ALTER TABLE public.campaign_info
ADD COLUMN IF NOT EXISTS booking_info TEXT;

COMMENT ON COLUMN public.campaign_info.booking_info IS 'Информация для клиента при бронировании (вход, правила и т.д.)';
