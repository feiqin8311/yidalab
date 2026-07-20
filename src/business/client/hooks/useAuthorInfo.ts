export interface AuthorInfo {
  avatar?: string | null;
  username?: string | null;
}

export const useAuthorInfo = (_userId?: string): AuthorInfo | undefined => undefined;
