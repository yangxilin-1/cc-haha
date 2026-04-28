import type { ReactNode } from 'react'

type IconProps = {
  className?: string
  size?: number
}

function BaseIcon({
  className,
  size = 18,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function FolderLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </BaseIcon>
  )
}

export function FileLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </BaseIcon>
  )
}

export function TerminalLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="m7 10 2 2-2 2" />
      <path d="M11 14h4" />
    </BaseIcon>
  )
}

export function PreviewLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </BaseIcon>
  )
}

export function CodeLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </BaseIcon>
  )
}

export function ImageLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </BaseIcon>
  )
}

export function ComputerUseLineIcon({ className, size = 18 }: IconProps) {
  return (
    <BaseIcon className={className} size={size}>
      <rect width="18" height="14" x="3" y="4" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 18v3" />
      <path d="m10 9 2 2 4-4" />
    </BaseIcon>
  )
}
