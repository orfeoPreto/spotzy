import { APIGatewayProxyHandler } from 'aws-lambda';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SUPPORTED_LOCALES } from '../../../shared/locales/constants';
import type { SupportedLocale } from '../../../shared/locales/constants';
import { toTranslateLanguageCode } from '../../../shared/locales/translate-language-code';
import { getCachedTranslation, putCachedTranslation } from '../../../shared/locales/translation-cache';
import { ok, badRequest, unauthorized, internalError } from '../../../shared/utils/response';
import { extractClaims } from '../../../shared/utils/auth';
import { createLogger } from '../../../shared/utils/logger';

const translate = new TranslateClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('translate-on-demand', event.requestContext.requestId, claims?.userId);

  if (!claims) return unauthorized();

  let body: any;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  const { contentType, sourceText, sourceLocale, targetLocale } = body;

  // Validation
  if (!['chat', 'review', 'dispute'].includes(contentType)) {
    return badRequest('INVALID_CONTENT_TYPE');
  }
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(sourceLocale) ||
      !(SUPPORTED_LOCALES as readonly string[]).includes(targetLocale)) {
    return badRequest('INVALID_LOCALE', { providedSource: sourceLocale, providedTarget: targetLocale });
  }
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'sourceText' });
  }

  // No-op: source equals target
  if (sourceLocale === targetLocale) {
    return ok({ data: { translatedText: sourceText, sourceLocale, cached: true } });
  }

  // Cache check
  const cached = await getCachedTranslation(
    dynamo, TABLE, sourceText, sourceLocale as SupportedLocale, targetLocale as SupportedLocale,
  );
  if (cached !== null) {
    return ok({ data: { translatedText: cached, sourceLocale, cached: true } });
  }

  // Translate
  let translatedText: string;
  try {
    const result = await translate.send(new TranslateTextCommand({
      Text: sourceText,
      SourceLanguageCode: toTranslateLanguageCode(sourceLocale as SupportedLocale),
      TargetLanguageCode: toTranslateLanguageCode(targetLocale as SupportedLocale),
    }));
    translatedText = result.TranslatedText ?? sourceText;
  } catch (err) {
    log.error('Translate API failure', err);
    return internalError();
  }

  // Cache write (fire and forget)
  putCachedTranslation(
    dynamo, TABLE, sourceText, sourceLocale as SupportedLocale, targetLocale as SupportedLocale,
    translatedText, contentType,
  ).catch((err) => log.error('Failed to write translation cache', err));

  return ok({ data: { translatedText, sourceLocale, cached: false } });
};
