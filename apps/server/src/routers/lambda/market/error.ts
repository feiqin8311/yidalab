import { TRPCError } from '@trpc/server';

const getStatus = (error: unknown) => (error as { status?: number })?.status;

const getMessage = (error: unknown, fallback: string) => {
  const errorBody = (error as { errorBody?: Record<string, unknown> })?.errorBody;
  return (
    (typeof errorBody?.error_description === 'string' && errorBody.error_description) ||
    (typeof errorBody?.message === 'string' && errorBody.message) ||
    (typeof errorBody?.error === 'string' && errorBody.error) ||
    fallback
  );
};

export const toMarketTRPCError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof TRPCError) return error;

  const status = getStatus(error);
  if (status === 401) {
    return new TRPCError({
      code: 'UNAUTHORIZED',
      message: getMessage(error, 'Market token is invalid or expired'),
    });
  }
  if (status === 429) {
    return new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: getMessage(error, 'Market is rate-limiting requests'),
    });
  }
  if (status === 404) {
    return new TRPCError({
      code: 'NOT_FOUND',
      message: getMessage(error, 'Market resource not found'),
    });
  }

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
  });
};
