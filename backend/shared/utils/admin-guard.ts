import { APIGatewayProxyEvent } from 'aws-lambda';

export interface AdminClaims {
  userId: string;
  email: string;
}

/**
 * Extracts Cognito JWT claims and verifies the caller belongs to the 'admin' group.
 * Returns null if the user is not authenticated or not an admin.
 */
export function extractAdminClaims(event: APIGatewayProxyEvent): AdminClaims | null {
  const claims = event.requestContext?.authorizer?.claims as
    | Record<string, string>
    | undefined;

  if (!claims) return null;

  const userId = claims['sub'];
  const email = claims['email'];
  if (!userId || !email) return null;

  // cognito:groups can be a string like "admin" or "admin,users"
  const groups = claims['cognito:groups'] ?? '';
  const groupList = groups.split(',').map((g) => g.trim());
  if (!groupList.includes('admin')) return null;

  return { userId, email };
}
