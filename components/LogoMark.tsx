// SPDX-License-Identifier: Apache-2.0

/** WinLot's mark: a white W on an emerald rounded square, three gold balls resting in its top. Same drawing as
 *  public/favicon.svg; colours are fixed (the mark reads the same in both themes). */
export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="100" height="100" rx="24" fill="#047857" />
      <path
        fill="#fff"
        d="M13 28h12.6l9.6 32.4L50 30l14.8 30.4L74.4 28H87L71.7 76.5H59.6L50 48.5l-9.6 28H28.3z"
      />
      <circle cx="50" cy="34" r="9" fill="#047857" />
      <circle cx="31" cy="32.6" r="5.4" fill="#e2b23c" />
      <circle cx="50" cy="34" r="6.6" fill="#e2b23c" />
      <circle cx="69" cy="32.6" r="5.4" fill="#e2b23c" />
    </svg>
  )
}
