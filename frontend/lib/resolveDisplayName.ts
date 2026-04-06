interface UserIdentity {
  pseudo?: string | null;
  firstName: string;
}

export const resolveDisplayName = (user: UserIdentity): string =>
  user.pseudo?.trim() || user.firstName;

export const resolveInitial = (user: UserIdentity): string =>
  resolveDisplayName(user).charAt(0).toUpperCase();
