import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { handler } from '../../functions/listings/listing-translate';

const ddbMock = mockClient(DynamoDBDocumentClient);
const translateMock = mockClient(TranslateClient);

beforeEach(() => {
  ddbMock.reset();
  translateMock.reset();
});

function makeEvent(detail: Record<string, unknown>) {
  return { detail } as any;
}

describe('listing-translate Lambda', () => {
  test('translates title, description into all non-source locales', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'LISTING#L1', SK: 'METADATA',
        title: 'Garage Avenue Louise',
        description: 'Garage spacieux.',
        originalLocale: 'fr-BE',
      },
    });
    translateMock.on(TranslateTextCommand).callsFake((input) => {
      if (input.TargetLanguageCode === 'en') return { TranslatedText: `EN:${input.Text}` };
      if (input.TargetLanguageCode === 'nl') return { TranslatedText: `NL:${input.Text}` };
      return { TranslatedText: input.Text };
    });
    ddbMock.on(UpdateCommand).resolves({});

    await handler(makeEvent({
      listingId: 'L1',
      originalLocale: 'fr-BE',
      fieldsChanged: ['title', 'description'],
      isPool: false,
    }));

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    const updateInput = updateCalls[0].args[0].input;
    expect(updateInput.ExpressionAttributeValues).toMatchObject({
      ':titleTranslations': {
        'fr-BE': 'Garage Avenue Louise',
        'en': 'EN:Garage Avenue Louise',
        'nl-BE': 'NL:Garage Avenue Louise',
      },
    });
  });

  test('skips the originalLocale (no self-translation)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'LISTING#L1', SK: 'METADATA', title: 'Test', originalLocale: 'fr-BE' },
    });
    translateMock.on(TranslateTextCommand).resolves({ TranslatedText: 'translated' });
    ddbMock.on(UpdateCommand).resolves({});

    await handler(makeEvent({
      listingId: 'L1',
      originalLocale: 'fr-BE',
      fieldsChanged: ['title'],
      isPool: false,
    }));

    const calls = translateMock.commandCalls(TranslateTextCommand);
    expect(calls.find(c => c.args[0].input.SourceLanguageCode === 'fr' && c.args[0].input.TargetLanguageCode === 'fr')).toBeUndefined();
  });

  test('skips translation for very short labels (< 4 chars)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'LISTING#P1', SK: 'BAY#B1', label: 'A-3', originalLocale: 'en' },
    });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ PK: 'LISTING#P1', SK: 'BAY#B1', label: 'A-3', originalLocale: 'en' }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    await handler(makeEvent({
      listingId: 'P1',
      originalLocale: 'en',
      fieldsChanged: ['title'],
      isPool: true,
    }));

    // Translate should NOT be called for the short bay label
    const calls = translateMock.commandCalls(TranslateTextCommand);
    expect(calls.find(c => c.args[0].input.Text === 'A-3')).toBeUndefined();
  });

  test('falls back to source text on permanent Translate failure', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'LISTING#L1', SK: 'METADATA', title: 'Garage', originalLocale: 'en' },
    });
    translateMock.on(TranslateTextCommand).rejects(new Error('Persistent failure'));
    ddbMock.on(UpdateCommand).resolves({});

    await handler(makeEvent({
      listingId: 'L1',
      originalLocale: 'en',
      fieldsChanged: ['title'],
      isPool: false,
    }));

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    const translations = updateCalls[0].args[0].input.ExpressionAttributeValues?.[':titleTranslations'];
    // All locales should have the source text as fallback
    expect(translations).toEqual({
      en: 'Garage',
      'fr-BE': 'Garage',
      'nl-BE': 'Garage',
    });
  });

  test('pool listing → also translates BAY# children', async () => {
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.Key.SK === 'METADATA') {
        return { Item: { PK: 'LISTING#P1', SK: 'METADATA', title: 'Pool', originalLocale: 'en' } };
      }
      if (input.Key.SK === 'BAY#B1') {
        return { Item: { PK: 'LISTING#P1', SK: 'BAY#B1', label: 'Bay Alpha', originalLocale: 'en' } };
      }
      return { Item: undefined };
    });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ PK: 'LISTING#P1', SK: 'BAY#B1', label: 'Bay Alpha', originalLocale: 'en' }],
    });
    translateMock.on(TranslateTextCommand).resolves({ TranslatedText: 'translated' });
    ddbMock.on(UpdateCommand).resolves({});

    await handler(makeEvent({
      listingId: 'P1',
      originalLocale: 'en',
      fieldsChanged: ['title'],
      isPool: true,
    }));

    // Should have at least 2 UpdateCommands (parent + 1 bay)
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
  });
});
