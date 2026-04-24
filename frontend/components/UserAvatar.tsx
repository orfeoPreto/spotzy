'use client';

import { resolveDisplayName, resolveInitial } from '../lib/resolveDisplayName';

interface UserAvatarProps {
  user: { photoUrl?: string | null; pseudo?: string | null; firstName: string };
  size: number;
  className?: string;
}

export function UserAvatar({ user, size, className = '' }: UserAvatarProps) {
  return (
    <div
      data-testid="avatar-container"
      className={`rounded-full overflow-hidden ring-2 ring-[#004526] flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {user.photoUrl ? (
        <img
          src={user.photoUrl}
          alt={resolveDisplayName(user)}
          className="w-full h-full object-cover rounded-full"
        />
      ) : (
        <div
          data-testid="avatar-fallback"
          className="w-full h-full bg-[#004526] flex items-center justify-center"
        >
          <span
            className="text-white font-bold select-none"
            style={{ fontSize: size * 0.4 }}
          >
            {resolveInitial(user)}
          </span>
        </div>
      )}
    </div>
  );
}
