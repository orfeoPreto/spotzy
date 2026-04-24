import { S3Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, CopyObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { RekognitionClient, DetectLabelsCommand, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const rek = new RekognitionClient({ region: 'eu-west-1' });

const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET ?? 'spotzy-media-uploads';
const PUBLIC_BUCKET = process.env.PUBLIC_BUCKET ?? 'spotzy-media-public';

const PARKING_LABELS = new Set([
  'Parking', 'Garage', 'Car Park', 'Parking Lot', 'Carport', 'Driveway',
  'Parking Garage', 'Underground Garage', 'Indoor Parking',
]);
const PARKING_ADJACENT_LABELS = new Set([
  'Road', 'Asphalt', 'Vehicle', 'Car', 'Floor', 'Concrete',
  'Building', 'Warehouse', 'Path', 'Sidewalk', 'Gate', 'Door',
]);
const CLEANLINESS_LABELS = new Set(['Trash', 'Garbage', 'Rubbish']);
const PASS_CONFIDENCE = 60;
const REVIEW_CONFIDENCE = 35;
const MODERATION_THRESHOLD = 70;
const CLEANLINESS_THRESHOLD = 80;
const ADJACENT_REVIEW_CONFIDENCE = 60;

type ValidationStatus = 'PASS' | 'FAIL' | 'REVIEW';

export const handler: S3Handler = async (event) => {
  const log = createLogger('listing-ai-validate', event.Records[0]?.s3.object.eTag ?? 'unknown');

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    // Key format: listings/{listingId}/photos/{photoIndex}.jpg
    const match = key.match(/^listings\/([^/]+)\/photos\/(\d+)\./);
    if (!match) { log.warn('unrecognised s3 key format', { key }); continue; }

    const listingId = match[1];
    const photoIndex = parseInt(match[2], 10);
    log.info('validating photo', { listingId, photoIndex, key });

    // Download image bytes from S3 (eu-west-3) to pass to Rekognition (eu-west-1)
    const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const imageBytes = await s3Obj.Body?.transformToByteArray();
    if (!imageBytes) { log.warn('empty image body', { key }); continue; }

    const magic = Array.from(imageBytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const isJpeg = imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff;
    const isPng = imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4e && imageBytes[3] === 0x47;
    log.info('image downloaded', { key, sizeBytes: imageBytes.byteLength, magic, isJpeg, isPng });

    let status: ValidationStatus = 'FAIL';
    let validationReason: string | undefined;

    // Rekognition Bytes limit is 5 MB
    if (imageBytes.byteLength > 5 * 1024 * 1024) {
      status = 'FAIL';
      validationReason = 'Image is too large. Please upload a photo smaller than 5 MB.';
      log.warn('image too large for rekognition', { key, sizeBytes: imageBytes.byteLength });
    } else if (!isJpeg && !isPng) {
      status = 'FAIL';
      validationReason = 'Unsupported format. Please upload a JPEG or PNG photo.';
      log.warn('unsupported image format by magic bytes', { key, magic: Array.from(imageBytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ') });
    } else
    try {
      // Run Rekognition in parallel
      const [labelsResult, moderationResult] = await Promise.all([
        rek.send(new DetectLabelsCommand({ Image: { Bytes: imageBytes }, MaxLabels: 50, MinConfidence: 50 })),
        rek.send(new DetectModerationLabelsCommand({ Image: { Bytes: imageBytes }, MinConfidence: MODERATION_THRESHOLD })),
      ]);

      const labels = labelsResult.Labels ?? [];
      const moderationLabels = moderationResult.ModerationLabels ?? [];

      // Check moderation first (fail-fast)
      if (moderationLabels.length > 0) {
        status = 'FAIL';
        validationReason = `Inappropriate content detected: ${moderationLabels.map((l) => l.Name).join(', ')}`;
      } else {
        // Check cleanliness
        const cleanlinessIssue = labels.find(
          (l) => CLEANLINESS_LABELS.has(l.Name ?? '') && (l.Confidence ?? 0) >= CLEANLINESS_THRESHOLD
        );
        if (cleanlinessIssue) {
          status = 'FAIL';
          validationReason = `Cleanliness issue detected: ${cleanlinessIssue.Name}`;
        } else {
          // Check parking labels
          const parkingLabel = labels.find((l) => PARKING_LABELS.has(l.Name ?? ''));
          if (parkingLabel && (parkingLabel.Confidence ?? 0) >= PASS_CONFIDENCE) {
            status = 'PASS';
          } else if (parkingLabel && (parkingLabel.Confidence ?? 0) >= REVIEW_CONFIDENCE) {
            status = 'REVIEW';
            validationReason = `Low confidence parking detection: ${parkingLabel.Confidence?.toFixed(1)}%`;
          } else {
            // No parking label or below REVIEW threshold — check adjacent labels
            const adjacentLabel = labels.find(
              (l) => PARKING_ADJACENT_LABELS.has(l.Name ?? '') && (l.Confidence ?? 0) >= ADJACENT_REVIEW_CONFIDENCE
            );
            if (adjacentLabel) {
              status = 'REVIEW';
              validationReason = `No direct parking label, but related content detected: ${adjacentLabel.Name}`;
            } else {
              status = 'FAIL';
              validationReason = 'No parking-related content detected';
            }
          }
        }
      }
    } catch (err: unknown) {
      const errName = (err as { name?: string }).name ?? '';
      log.error('rekognition error', { key, errName, err });
      status = 'FAIL';
      if (errName === 'InvalidImageFormatException') {
        validationReason = 'Unsupported image format. Please upload a JPEG or PNG photo.';
      } else {
        validationReason = 'Image validation service error. Please try again.';
      }
    }

    // Update DynamoDB
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `LISTING#${listingId}`, SK: 'METADATA' },
      UpdateExpression: `SET photos[${photoIndex}].validationStatus = :status, photos[${photoIndex}].validationReason = :reason, updatedAt = :now`,
      ExpressionAttributeValues: {
        ':status': status,
        ':reason': validationReason ?? null,
        ':now': new Date().toISOString(),
      },
    }));

    log.info('photo validation result', { listingId, photoIndex, status, validationReason });

    // Copy to public bucket on PASS — prefix with media/ so CloudFront /media/* serves it
    if (status === 'PASS') {
      await s3.send(new CopyObjectCommand({
        Bucket: PUBLIC_BUCKET,
        CopySource: `${UPLOADS_BUCKET}/${key}`,
        Key: `media/${key}`,
      }));
    }
  }
};
