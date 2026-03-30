import { S3Event } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, CopyObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { RekognitionClient, DetectLabelsCommand, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/ai-validate/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const rekMock = mockClient(RekognitionClient);

const makeEvent = (key = 'listings/listing_01/photos/0.jpg'): S3Event =>
  ({ Records: [{ s3: { bucket: { name: 'spotzy-media-uploads' }, object: { key } } }] } as unknown as S3Event);

// Valid JPEG magic bytes: ff d8 ff e0
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  rekMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  s3Mock.on(CopyObjectCommand).resolves({});
  s3Mock.on(GetObjectCommand).resolves({
    Body: { transformToByteArray: () => Promise.resolve(jpegBytes) } as any,
  });
});

describe('listing-ai-validate', () => {
  it('Garage label ≥80% confidence → PASS, file copied to public bucket', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Garage', Confidence: 90 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent(), {} as any, () => {});
    const update = ddbMock.commandCalls(UpdateCommand)[0];
    const vals = update.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('PASS');
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(1);
  });

  it('Parking label ≥80% → PASS', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Parking', Confidence: 85 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent(), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('PASS');
  });

  it('no parking labels → FAIL, file NOT copied', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Tree', Confidence: 95 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent(), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('FAIL');
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('parking label confidence 60% (50-80%) → REVIEW, file NOT copied', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Parking', Confidence: 60 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent(), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('REVIEW');
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('moderation label SuggestiveFemale ≥70% → FAIL regardless', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Parking', Confidence: 95 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [{ Name: 'SuggestiveFemale', Confidence: 75 }] });
    await handler(makeEvent(), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('FAIL');
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('Trash label ≥60% → FAIL', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Parking', Confidence: 90 }, { Name: 'Trash', Confidence: 65 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent(), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('FAIL');
  });

  it('Clutter label ≥60% → FAIL', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Parking', Confidence: 90 }, { Name: 'Clutter', Confidence: 70 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent(), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('FAIL');
  });

  it('PASS: CopyObject called with correct buckets', async () => {
    rekMock.on(DetectLabelsCommand).resolves({ Labels: [{ Name: 'Garage', Confidence: 90 }] });
    rekMock.on(DetectModerationLabelsCommand).resolves({ ModerationLabels: [] });
    await handler(makeEvent('listings/listing_01/photos/0.jpg'), {} as any, () => {});
    const copy = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(copy.Bucket).toBe(process.env.PUBLIC_BUCKET ?? 'spotzy-media-public');
    expect(copy.CopySource).toContain('listings/listing_01/photos/0.jpg');
  });
});
