export const manualThreadTitlesSql = `
ALTER TABLE thread ADD COLUMN title_manually_set INTEGER NOT NULL DEFAULT 0
	CHECK (title_manually_set IN (0, 1));
UPDATE thread SET title_manually_set = 1;
`;
