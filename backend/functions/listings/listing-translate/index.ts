import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SUPPORTED_LOCALES } from '../../../shared/locales/constants';
import type { SupportedLocale } from '../../../shared/locales/constants';
import { toTranslateLanguageCode } from '../../../shared/locales/translate-language-code';
import { createLogger } from '../../../shared/utils/logger';

const translate = new TranslateClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const SHORT_TEXT_THRESHOLD = 4;

interface TranslationEvent {
  detail: {
    listingId: string;
    originalLocale: SupportedLocale;
    fieldsChanged: string[];
    isPool: boolean;
  };
}

export const handler = async (event: TranslationEvent) => {
  const log = createLogger('listing-translate', 'eventbridge');
  const { listingId, originalLocale, fieldsChanged, isPool } = event.detail;

  log.info('translating listing', { listingId, originalLocale, fieldsChanged, isPool });

  // 1. Translate the parent listing fields
  await translateEntity(`LISTING#${listingId}`, 'METADATA', originalLocale, fieldsChanged, log);

  // 2. If it's a pool, translate the BAY# children too
  if (isPool) {
    const bays = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BAY#' },
    }));
    for (const bay of bays.Items ?? []) {
      const bayOriginalLocale = (bay.originalLocale as SupportedLocale) ?? originalLocale;
      await translateEntity(bay.PK as string, bay.SK as string, bayOriginalLocale, ['label', 'accessInstructions'], log);
    }
  }

  log.info('translation complete', { listingId });
};

async function translateEntity(
  pk: string,
  sk: string,
  originalLocale: SupportedLocale,
  fields: string[],
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const item = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }));
  if (!item.Item) return;

  const updates: Record<string, Record<string, string>> = {};

  for (const field of fields) {
    const sourceText = item.Item[field] as string | undefined;
    if (!sourceText) continue;

    const translations: Record<string, string> = { [originalLocale]: sourceText };

    // Skip translation for very short content (e.g., bay labels like "A-3")
    if (sourceText.length < SHORT_TEXT_THRESHOLD) {
      for (const target of SUPPORTED_LOCALES) {
        translations[target] = sourceText;
      }
      updates[`${field}Translations`] = translations;
      continue;
    }

    for (const target of SUPPORTED_LOCALES) {
      if (target === originalLocale) continue;
      translations[target] = await translateWithRetry(sourceText, originalLocale, target, log);
    }

    updates[`${field}Translations`] = translations;
  }

  if (Object.keys(updates).length === 0) return;

  // Build the UpdateExpression
  const updateParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  for (const [field, translations] of Object.entries(updates)) {
    const safeName = field.replace(/[^a-zA-Z0-9]/g, '_');
    const namePh = `#${safeName}`;
    const valuePh = `:${safeName}`;
    updateParts.push(`${namePh} = ${valuePh}`);
    exprNames[namePh] = field;
    exprValues[valuePh] = translations;
  }
  updateParts.push('#tlcat = :tlcat');
  exprNames['#tlcat'] = 'translationsLastComputedAt';
  exprValues[':tlcat'] = new Date().toISOString();

  await dynamo.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: pk, SK: sk },
    UpdateExpression: 'SET ' + updateParts.join(', '),
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }));
}

async function translateWithRetry(
  text: string,
  source: SupportedLocale,
  target: SupportedLocale,
  log: ReturnType<typeof createLogger>,
  maxRetries: number = 3,
): Promise<string> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await translate.send(new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: toTranslateLanguageCode(source),
        TargetLanguageCode: toTranslateLanguageCode(target),
      }));
      return result.TranslatedText ?? text;
    } catch (err: any) {
      attempt++;
      if (err.name === 'ThrottlingException' && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
        continue;
      }
      // Permanent failure → fall back to source text
      log.error(`Translation failed for ${source}→${target}`, err);
      return text;
    }
  }
  return text;
}
