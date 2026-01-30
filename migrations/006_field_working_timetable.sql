-- Field Working Timetable: разное время работы по дням недели + перерывы
--
-- Формат working_timetable:
-- {
--   "monday": { "from": "08:00", "to": "22:00", "breaks": [{ "from": "13:00", "to": "14:00", "reason": "Обед" }] },
--   "saturday": { "from": "10:00", "to": "18:00" },
--   "sunday": null
-- }
-- null = выходной, отсутствие ключа = наследуется от кампании

-- 1. Добавляем колонку working_timetable
ALTER TABLE public.fields
ADD COLUMN IF NOT EXISTS working_timetable JSONB DEFAULT NULL;

-- 2. Индекс для поиска по расписанию (GIN для JSONB)
CREATE INDEX IF NOT EXISTS idx_fields_working_timetable ON public.fields USING GIN (working_timetable);

-- 3. Комментарий
COMMENT ON COLUMN public.fields.working_timetable IS 'Расписание работы поля по дням недели с перерывами (JSONB). null = выходной, отсутствие = наследуется от площадки';

-- Старые колонки working_hours_from, working_hours_to, working_days НЕ удаляем
-- Они остаются для обратной совместимости и fallback логики
