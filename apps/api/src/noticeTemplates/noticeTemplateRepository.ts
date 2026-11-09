import type pg from 'pg';
import type { NoticeTemplateInputDetails } from './noticePlaceholders.js';

export interface NoticeTemplateDetails extends NoticeTemplateInputDetails {
  templateId: number;
  updatedAt: string;
}

// Every query is scoped to one creator. Rows with no creator are the pristine defaults (migration 012): they are
// copied to a creator at sign-up and are never listed, read or changed through the API.
const TEMPLATE_COLUMNS_SQL = 'id AS "templateId", platform, name, subject, body, updated_at AS "updatedAt"';

function toTemplateDetails(templateRow: NoticeTemplateDetails): NoticeTemplateDetails {
  return { ...templateRow, templateId: Number(templateRow.templateId) };
}

export async function listNoticeTemplates(pool: pg.Pool, creatorId: number): Promise<NoticeTemplateDetails[]> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(
      `SELECT ${TEMPLATE_COLUMNS_SQL} FROM notice_templates WHERE creator_id = $1 ORDER BY platform, updated_at DESC`, [creatorId],
    );
    return queryResult.rows.map(toTemplateDetails);
  } catch (error) {
    console.error('listNoticeTemplates failed', error);
    return [];
  }
}

export async function findNoticeTemplate(pool: pg.Pool, creatorId: number, templateId: number): Promise<NoticeTemplateDetails | undefined> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(
      `SELECT ${TEMPLATE_COLUMNS_SQL} FROM notice_templates WHERE creator_id = $1 AND id = $2`, [creatorId, templateId],
    );
    return queryResult.rows[0] ? toTemplateDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findNoticeTemplate failed', error);
    return undefined;
  }
}

export async function insertNoticeTemplate(pool: pg.Pool, creatorId: number, templateInput: NoticeTemplateInputDetails): Promise<NoticeTemplateDetails | undefined> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(
      `INSERT INTO notice_templates (creator_id, platform, name, subject, body) VALUES ($1, $2, $3, $4, $5) RETURNING ${TEMPLATE_COLUMNS_SQL}`,
      [creatorId, templateInput.platform, templateInput.name, templateInput.subject, templateInput.body],
    );
    return queryResult.rows[0] ? toTemplateDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('insertNoticeTemplate failed', error);
    return undefined;
  }
}

export async function updateNoticeTemplate(pool: pg.Pool, creatorId: number, templateId: number,
  templateInput: NoticeTemplateInputDetails): Promise<NoticeTemplateDetails | undefined> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(
      `UPDATE notice_templates SET platform = $3, name = $4, subject = $5, body = $6, updated_at = now()
       WHERE creator_id = $1 AND id = $2 RETURNING ${TEMPLATE_COLUMNS_SQL}`,
      [creatorId, templateId, templateInput.platform, templateInput.name, templateInput.subject, templateInput.body],
    );
    return queryResult.rows[0] ? toTemplateDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('updateNoticeTemplate failed', error);
    return undefined;
  }
}

export async function deleteNoticeTemplate(pool: pg.Pool, creatorId: number, templateId: number): Promise<boolean> {
  try {
    const queryResult = await pool.query('DELETE FROM notice_templates WHERE creator_id = $1 AND id = $2', [creatorId, templateId]);
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('deleteNoticeTemplate failed', error);
    return false;
  }
}
