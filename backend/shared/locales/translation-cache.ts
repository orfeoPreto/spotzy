import { createHash } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TRANSLATION_CACHE_TTL_DAYS, DISPUTE_TRANSLATION_CACHE_TTL_DAYS } from './constants';
import type { SupportedLocale } from './constants';

export function buildCacheKey(
  sourceText: string,
  sourceLocale: SupportedLocale,
  targetLocale: SupportedLocale,
): string {
  return createHash('sha256')
    .update(`${sourceText}\u0000${sourceLocale}\u0000${targetLocale}`)
    .digest('hex');
}

export async function getCachedTranslation(
  client: DynamoDBDocumentClient,
  tableName: string,
  sourceText: string,
  sourceLocale: SupportedLocale,
  targetLocale: SupportedLocale,
): Promise<string | null> {
  const cacheKey = buildCacheKey(sourceText, sourceLocale, targetLocale);
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `TRANSLATION_CACHE#${cacheKey}`, SK: 'METADATA' },
    }),
  );
  if (!result.Item) return null;

  // Async hit count update — fire and forget
  client
    .send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `TRANSLATION_CACHE#${cacheKey}`, SK: 'METADATA' },
        UpdateExpression: 'ADD hitCount :one',
        ExpressionAttributeValues: { ':one': 1 },
      }),
    )
    .catch((err) => console.error('Failed to increment translation cache hit count', err));

  return result.Item.translatedText as string;
}

export async function putCachedTranslation(
  client: DynamoDBDocumentClient,
  tableName: string,
  sourceText: string,
  sourceLocale: SupportedLocale,
  targetLocale: SupportedLocale,
  translatedText: string,
  contentType: 'chat' | 'review' | 'dispute',
): Promise<void> {
  const cacheKey = buildCacheKey(sourceText, sourceLocale, targetLocale);
  const ttlDays =
    contentType === 'dispute' ? DISPUTE_TRANSLATION_CACHE_TTL_DAYS : TRANSLATION_CACHE_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600 * 1000);

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `TRANSLATION_CACHE#${cacheKey}`,
        SK: 'METADATA',
        sourceText,
        sourceLocale,
        targetLocale,
        translatedText,
        computedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        expiresAtTtl: Math.floor(expiresAt.getTime() / 1000),
        hitCount: 0,
        contentType,
      },
    }),
  );
}
