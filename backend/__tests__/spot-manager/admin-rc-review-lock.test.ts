import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/spot-manager/admin-rc-review-lock/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (adminId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: adminId, email: `${adminId}@spotzy.be`, 'cognito:groups': 'admin' } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? null,
  ...overrides,
} as any);

beforeEach(() => {
  ddbMock.reset();
});

describe('admin-rc-review-lock', () => {
  it('returns 403 for non-admin', async () => {
    const event = {
      requestContext: { authorizer: { claims: { sub: 'user-1', email: 'u@s.com', 'cognito:groups': 'users' } }, requestId: 'r1' },
      body: null,
      pathParameters: { submissionId: 'sub-1' },
    } as any;
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  it('returns 400 when submissionId is missing', async () => {
    const result = await handler(mockAdminEvent('admin-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  it('acquires lock successfully', async () => {
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      mockAdminEvent('admin-1', { pathParameters: { submissionId: 'sub-1' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissionId).toBe('sub-1');
    expect(body.lockedBy).toBe('admin-1');
    expect(body.expiresAt).toBeDefined();

    // Verify PutCommand was sent with correct condition
    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    const input = putCalls[0].args[0].input;
    expect(input.Item!.PK).toBe('RC_SOFT_LOCK#sub-1');
    expect(input.Item!.SK).toBe('METADATA');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
    expect(input.ConditionExpression).toContain('lockedBy = :adminId');
    expect(input.ConditionExpression).toContain('expiresAt < :now');
  });

  it('returns 409 LOCK_HELD when condition check fails', async () => {
    const conditionError = new Error('ConditionalCheckFailed');
    (conditionError as any).name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejects(conditionError);

    const result = await handler(
      mockAdminEvent('admin-1', { pathParameters: { submissionId: 'sub-1' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(409);
    const body = JSON.parse(result!.body);
    expect(body.error).toBe('LOCK_HELD');
  });

  it('includes ttl field in lock item', async () => {
    ddbMock.on(PutCommand).resolves({});

    await handler(
      mockAdminEvent('admin-1', { pathParameters: { submissionId: 'sub-1' } }),
      {} as any,
      () => {},
    );

    const putCalls = ddbMock.commandCalls(PutCommand);
    const item = putCalls[0].args[0].input.Item!;
    expect(typeof item.ttl).toBe('number');
    // ttl should be in the future (epoch seconds)
    expect(item.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('re-throws non-condition errors', async () => {
    ddbMock.on(PutCommand).rejects(new Error('InternalServerError'));

    await expect(
      handler(
        mockAdminEvent('admin-1', { pathParameters: { submissionId: 'sub-1' } }),
        {} as any,
        () => {},
      ),
    ).rejects.toThrow('InternalServerError');
  });
});
