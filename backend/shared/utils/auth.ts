import { APIGatewayProxyEvent } from 'aws-lambda';

export interface AuthClaims {
  userId: string;
  email: string;
}

/**
 * Extracts the Cognito JWT claims from the API Gateway event's
 * requestContext.authorizer.claims. Returns null if the claims are missing
 * (unauthenticated request — should not reach an auth-required Lambda).
 */
export const extractClaims = (event: APIGatewayProxyEvent): AuthClaims | null => {
  const claims = event.requestContext?.authorizer?.claims as
    | Record<string, string>
    | undefined;

  if (!claims) {
    return null;
  }

  const userId = claims['sub'];
  const email = claims['email'];

  if (!userId || !email) {
    return null;
  }

  return { userId, email };
};

/**
 * Same as extractClaims but throws if claims are absent.
 * Use inside auth-required handlers after the Cognito authorizer has already
 * validated the token — this should never actually throw in production.
 */
export const requireClaims = (event: APIGatewayProxyEvent): AuthClaims => {
  const claims = extractClaims(event);
  if (!claims) {
    throw new Error('Missing Cognito authorizer claims on authenticated route');
  }
  return claims;
};
