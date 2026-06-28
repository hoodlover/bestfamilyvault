interface Props {
  children: React.ReactNode
  taps?: number
  popupSrc?: string
  popupScale?: number
  popupDurationMs?: number
  className?: string
}

export function SecretTapEgg({
  children,
  taps,
  popupSrc,
  popupScale,
  popupDurationMs,
  className,
}: Props) {
  void taps
  void popupSrc
  void popupScale
  void popupDurationMs

  return <span className={className}>{children}</span>
}
