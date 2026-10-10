import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { NOTICE_PLACEHOLDER_LIST, parseTemplateBody } from './noticePlaceholders.js';
import {
  deleteNoticeTemplate, findNoticeTemplate, insertNoticeTemplate, listNoticeTemplates, updateNoticeTemplate,
} from './noticeTemplateRepository.js';

const NOT_FOUND_MESSAGE = 'Notice template not found';

function parseTemplateId(rawParams: unknown): number {
  const templateId = Number((rawParams as { templateId?: string }).templateId);
  return Number.isInteger(templateId) && templateId > 0 ? templateId : 0;
}

// The evidence worker uses the most recently updated template for the copy's platform
export function registerNoticeTemplateRoutes(server: FastifyInstance, pool: pg.Pool): void {
  server.get('/notice-templates', async () => {
    const noticeTemplateList = await listNoticeTemplates(pool);
    return { noticeTemplateList, noticeTemplateCount: noticeTemplateList.length, placeholderList: NOTICE_PLACEHOLDER_LIST };
  });

  server.get('/notice-templates/:templateId', async (request, reply) => {
    const templateId = parseTemplateId(request.params);
    const templateDetails = templateId ? await findNoticeTemplate(pool, templateId) : undefined;
    return templateDetails ?? reply.code(404).send({ isError: true, message: NOT_FOUND_MESSAGE });
  });

  server.post('/notice-templates', async (request, reply) => {
    const parseResult = parseTemplateBody(request.body);
    if (parseResult.isError) return reply.code(400).send(parseResult);
    const createdTemplate = await insertNoticeTemplate(pool, parseResult.templateInput);
    if (!createdTemplate) throw new Error('insertNoticeTemplate returned nothing');
    return reply.code(201).send(createdTemplate);
  });

  server.put('/notice-templates/:templateId', async (request, reply) => {
    const templateId = parseTemplateId(request.params);
    const parseResult = parseTemplateBody(request.body);
    if (parseResult.isError) return reply.code(400).send(parseResult);
    const updatedTemplate = templateId ? await updateNoticeTemplate(pool, templateId, parseResult.templateInput) : undefined;
    return updatedTemplate ?? reply.code(404).send({ isError: true, message: NOT_FOUND_MESSAGE });
  });

  server.delete('/notice-templates/:templateId', async (request, reply) => {
    const templateId = parseTemplateId(request.params);
    const isDeleted = templateId ? await deleteNoticeTemplate(pool, templateId) : false;
    if (!isDeleted) return reply.code(404).send({ isError: true, message: NOT_FOUND_MESSAGE });
    return reply.code(204).send();
  });
}
