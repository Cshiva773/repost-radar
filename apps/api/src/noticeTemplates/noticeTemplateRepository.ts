import type pg from 'pg';
import type { NoticeTemplateInputDetails } from './noticePlaceholders.js';

export interface NoticeTemplateDetails extends NoticeTemplateInputDetails {
  templateId: number;
  updatedAt: string;
}

const TEMPLATE_COLUMNS_SQL = 'id AS "templateId", platform, name, subject, body, updated_at AS "updatedAt"';

function toTemplateDetails(templateRow: NoticeTemplateDetails): NoticeTemplateDetails {
  return { ...templateRow, templateId: Number(templateRow.templateId) };
}

export async function listNoticeTemplates(pool: pg.Pool): Promise<NoticeTemplateDetails[]> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(`SELECT ${TEMPLATE_COLUMNS_SQL} FROM notice_templates ORDER BY platform, updated_at DESC`);
    return queryResult.rows.map(toTemplateDetails);
  } catch (error) {
    console.error('listNoticeTemplates failed', error);
    return [];
  }
}

export async function findNoticeTemplate(pool: pg.Pool, templateId: number): Promise<NoticeTemplateDetails | undefined> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(`SELECT ${TEMPLATE_COLUMNS_SQL} FROM notice_templates WHERE id = $1`, [templateId]);
    return queryResult.rows[0] ? toTemplateDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findNoticeTemplate failed', error);
    return undefined;
  }
}

export async function insertNoticeTemplate(pool: pg.Pool, templateInput: NoticeTemplateInputDetails): Promise<NoticeTemplateDetails | undefined> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(
      `INSERT INTO notice_templates (platform, name, subject, body) VALUES ($1, $2, $3, $4) RETURNING ${TEMPLATE_COLUMNS_SQL}`,
      [templateInput.platform, templateInput.name, templateInput.subject, templateInput.body],
    );
    return queryResult.rows[0] ? toTemplateDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('insertNoticeTemplate failed', error);
    return undefined;
  }
}

export async function updateNoticeTemplate(pool: pg.Pool, templateId: number, templateInput: NoticeTemplateInputDetails): Promise<NoticeTemplateDetails | undefined> {
  try {
    const queryResult = await pool.query<NoticeTemplateDetails>(
      `UPDATE notice_templates SET platform = $2, name = $3, subject = $4, body = $5, updated_at = now() WHERE id = $1 RETURNING ${TEMPLATE_COLUMNS_SQL}`,
      [templateId, templateInput.platform, templateInput.name, templateInput.subject, templateInput.body],
    );
    return queryResult.rows[0] ? toTemplateDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('updateNoticeTemplate failed', error);
    return undefined;
  }
}

export async function deleteNoticeTemplate(pool: pg.Pool, templateId: number): Promise<boolean> {
  try {
    const queryResult = await pool.query('DELETE FROM notice_templates WHERE id = $1', [templateId]);
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('deleteNoticeTemplate failed', error);
    return false;
  }
}
