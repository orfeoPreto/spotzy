// Mock all AWS SDK modules
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-rekognition');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('@aws-sdk/client-scheduler');

// Test constants
export const TEST_USER_ID = 'user_01HX1234';
export const TEST_LISTING_ID = 'listing_01HX5678';
export const TEST_HOST_ID = 'user_01HX1234';

// JWT claims mock
export const mockAuthContext = (userId = TEST_USER_ID) => ({
  requestContext: {
    authorizer: { claims: { sub: userId, email: 'test@spotzy.be' } }
  }
});
