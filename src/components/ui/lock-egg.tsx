interface Props {
  src: string
  alt?: string
  width?: number
  height?: number
  className?: string
}

export function LockEgg({
  src,
  alt = '',
  width = 48,
  height = 48,
  className = 'block h-12 w-12 object-contain shrink-0 rounded-xl',
}: Props) {
  return <img src={src} alt={alt} width={width} height={height} className={className} />
}
