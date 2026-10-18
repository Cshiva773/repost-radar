import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { fromStoredAccounts, parseOwnAccountList, toStoredAccounts, type OwnAccountDetails } from './ownAccounts.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_LIMIT_BY_NAME = { name: 120, legalName: 200, contactEmail: 254, mailingAddress: 500 } as const;

export interface CreatorProfileDetails {
  creatorId: number;
  name: string;
  legalName: string | null;
  contactEmail: string | null;
  mailingAddress: string | null;
  /** IANA zone (e.g. Asia/Kolkata) for the dates and times on notices */
  timeZone: string;
  /** True when every field a takedown notice needs is filled in */
  isNoticeReady: boolean;
  /** Matches on posts from these accounts are the creator's own and cannot be approved */
  ownAccountList: OwnAccountDetails[];
}

type ProfileInputDetails = Omit<CreatorProfileDetails, 'creatorId' | 'isNoticeReady' | 'timeZone' | 'ownAccountList'>
  & { timeZone: string | null; ownAccountList: OwnAccountDetails[] | null };

type ProfileRow = Omit<CreatorProfileDetails, 'isNoticeReady' | 'ownAccountList'> & { ownAccounts: string[] };

const PROFILE_COLUMNS_SQL = `id AS "creatorId", name, legal_name AS "legalName", contact_email AS "contactEmail", mailing_address AS "mailingAddress",
  time_zone AS "timeZone", own_accounts AS "ownAccounts"`;

function toProfileDetails({ ownAccounts, ...profileRow }: ProfileRow): CreatorProfileDetails {
  const isNoticeReady = Boolean(profileRow.legalName && profileRow.contactEmail && profileRow.mailingAddress);
  return { ...profileRow, creatorId: Number(profileRow.creatorId), isNoticeReady, ownAccountList: fromStoredAccounts(ownAccounts) };
}

export async function findCreatorProfile(pool: pg.Pool, creatorId: number): Promise<CreatorProfileDetails | undefined> {
  try {
    const queryResult = await pool.query(`SELECT ${PROFILE_COLUMNS_SQL} FROM creators WHERE id = $1`, [creatorId]);
    return queryResult.rows[0] ? toProfileDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findCreatorProfile failed', error);
    return undefined;
  }
}

async function updateCreatorProfile(pool: pg.Pool, creatorId: number, profileInput: ProfileInputDetails): Promise<CreatorProfileDetails | undefined> {
  try {
    const queryResult = await pool.query(
      `UPDATE creators SET name = $2, legal_name = $3, contact_email = $4, mailing_address = $5, time_zone = COALESCE($6, time_zone),
         own_accounts = COALESCE($7::text[], own_accounts)
       WHERE id = $1 RETURNING ${PROFILE_COLUMNS_SQL}`,
      [creatorId, profileInput.name, profileInput.legalName, profileInput.contactEmail, profileInput.mailingAddress, profileInput.timeZone,
        profileInput.ownAccountList ? toStoredAccounts(profileInput.ownAccountList) : null],
    );
    return queryResult.rows[0] ? toProfileDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('updateCreatorProfile failed', error);
    return undefined;
  }
}

const MAX_TIME_ZONE_LENGTH = 64;

// An IANA zone the runtime knows (Intl throws RangeError for anything else)
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length > MAX_TIME_ZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function readOptionalText(rawValue: unknown, maxLength: number): string | null | 'invalid' {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  if (typeof rawValue !== 'string' || rawValue.trim().length > maxLength) return 'invalid';
  return rawValue.trim() || null;
}

export function parseProfileBody(rawBody: unknown): { isError: false; profileInput: ProfileInputDetails } | { isError: true; message: string } {
  const bodyDetails = (rawBody ?? {}) as Record<string, unknown>;
  const name = readOptionalText(bodyDetails.name, FIELD_LIMIT_BY_NAME.name);
  const legalName = readOptionalText(bodyDetails.legalName, FIELD_LIMIT_BY_NAME.legalName);
  const contactEmail = readOptionalText(bodyDetails.contactEmail, FIELD_LIMIT_BY_NAME.contactEmail);
  const mailingAddress = readOptionalText(bodyDetails.mailingAddress, FIELD_LIMIT_BY_NAME.mailingAddress);
  if (!name || name === 'invalid') return { isError: true, message: `name is required (≤ ${FIELD_LIMIT_BY_NAME.name} characters)` };
  if (legalName === 'invalid' || mailingAddress === 'invalid') return { isError: true, message: 'legalName or mailingAddress is too long' };
  if (contactEmail === 'invalid' || (contactEmail && !EMAIL_PATTERN.test(contactEmail))) return { isError: true, message: 'contactEmail must be an email address' };
  const timeZone = typeof bodyDetails.timeZone === 'string' && bodyDetails.timeZone.trim() ? bodyDetails.timeZone.trim() : null;
  if (timeZone && !isValidTimeZone(timeZone)) return { isError: true, message: `Unknown time zone "${timeZone}"` };
  const accountResult = parseOwnAccountList(bodyDetails.ownAccountList);
  if (accountResult.isError) return accountResult;
  return { isError: false, profileInput: { name, legalName, contactEmail, mailingAddress, timeZone, ownAccountList: accountResult.ownAccountList } };
}

function readCreatorId(request: FastifyRequest): number {
  if (!request.reviewer) throw new Error('Route reached without a reviewer');
  return request.reviewer.creatorId;
}

export function registerCreatorRoutes(server: FastifyInstance, pool: pg.Pool): void {
  server.get('/creator', async (request, reply) => {
    const profileDetails = await findCreatorProfile(pool, readCreatorId(request));
    return profileDetails ?? reply.code(404).send({ isError: true, message: 'Creator not found' });
  });

  server.put('/creator', async (request, reply) => {
    const parseResult = parseProfileBody(request.body);
    if (parseResult.isError) return reply.code(400).send(parseResult);
    const profileDetails = await updateCreatorProfile(pool, readCreatorId(request), parseResult.profileInput);
    return profileDetails ?? reply.code(404).send({ isError: true, message: 'Creator not found' });
  });
}
