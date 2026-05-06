import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export function IconBtn({
  icon,
  dot,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; dot?: boolean }) {
  return (
    <button className="iconbtn" {...rest}>
      <Icon name={icon} size={14} />
      {dot && <span className="iconbtn__dot" />}
    </button>
  )
}
