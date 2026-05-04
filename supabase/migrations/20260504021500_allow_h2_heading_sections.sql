-- Allow Step7 heading flow to persist h2 headings.
--
-- Rollback:
-- ALTER TABLE public.session_heading_sections
--   DROP CONSTRAINT IF EXISTS session_heading_sections_heading_level_check;
-- ALTER TABLE public.session_heading_sections
--   ADD CONSTRAINT session_heading_sections_heading_level_check
--   CHECK (heading_level IN (3, 4));

ALTER TABLE public.session_heading_sections
  DROP CONSTRAINT IF EXISTS session_heading_sections_heading_level_check;

ALTER TABLE public.session_heading_sections
  ADD CONSTRAINT session_heading_sections_heading_level_check
  CHECK (heading_level IN (2, 3, 4));
