-- 029: Field photos moderation (pending_photos)
-- Фото полей проходят премодерацию: загружаются в pending_photos,
-- публикуются в photos только после одобрения суперадмином.

ALTER TABLE fields ADD COLUMN pending_photos TEXT[];
