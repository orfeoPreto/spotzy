import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { handler } from '../../functions/translate/translate-on-demand';

const ddbMock = mockClient(DynamoDBDocumentClient);
const translateMock = mockClient(TranslateClient);

beforeEach(() => {
  ddbMock.reset();
  translateMock.reset();
});

function makeEvent(body: Record<string, unknown>, authenticated = true) {
  return {
    body: JSON.stringify(body),
    headers: {},
    requestContext: {
      requestId: 'test-req',
      authorizer: authenticated ? { claims: { sub: 'user-1', email: 'test@spotzy.be' } } : undefined,
    },
    pathParameters: {},
    queryStringParameters: {},
  } as any;
}

describe('translate-on-demand Lambda', () => {
  test('cache miss → calls Translate API, caches result', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    translateMock.on(TranslateTextCommand).resolves({ TranslatedText: 'Hallo, waar moet ik parkeren?' });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(makeEvent({
      contentType: 'chat',
      sourceText: 'Bonjour, où dois-je me garer ?',
      sourceLocale: 'fr-BE',
      targetLocale: 'nl-BE',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.data.cached).toBe(false);
    expect(body.data.translatedText).toBe('Hallo, waar moet ik parkeren?');
  });

  test('cache hit → returns cached translation, no Translate API call', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { translatedText: 'cached translation', hitCount: 3 },
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(makeEvent({
      contentType: 'chat',
      sourceText: 'Bonjour',
      sourceLocale: 'fr-BE',
      targetLocale: 'nl-BE',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.data.cached).toBe(true);
    expect(body.data.translatedText).toBe('cached translation');
    expect(translateMock.commandCalls(TranslateTextCommand)).toHaveLength(0);
  });

  test('source equals target → no-op, returns source text', async () => {
    const result = await handler(makeEvent({
      contentType: 'chat',
      sourceText: 'Hello',
      sourceLocale: 'en',
      targetLocale: 'en',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.data.translatedText).toBe('Hello');
    expect(body.data.cached).toBe(true);
  });

  test('invalid locale → 400 INVALID_LOCALE', async () => {
    const result = await handler(makeEvent({
      contentType: 'chat',
      sourceText: 'Hello',
      sourceLocale: 'pt-BR',
      targetLocale: 'en',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_LOCALE');
  });

  test('invalid content type → 400 INVALID_CONTENT_TYPE', async () => {
    const result = await handler(makeEvent({
      contentType: 'sms',
      sourceText: 'Hello',
      sourceLocale: 'en',
      targetLocale: 'fr-BE',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_CONTENT_TYPE');
  });

  test('unauthenticated request → 401', async () => {
    const result = await handler(makeEvent({
      contentType: 'chat',
      sourceText: 'Hello',
      sourceLocale: 'en',
      targetLocale: 'fr-BE',
    }, false), {} as any, () => {});

    expect(result!.statusCode).toBe(401);
  });

  test('Translate API failure → 500', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    translateMock.on(TranslateTextCommand).rejects(new Error('Service error'));

    const result = await handler(makeEvent({
      contentType: 'chat',
      sourceText: 'Hello',
      sourceLocale: 'en',
      targetLocale: 'fr-BE',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(500);
  });
});
