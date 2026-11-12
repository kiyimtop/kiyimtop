import { openExternalLink } from '../lib/platform.js'

// Ссылка на внешний сайт (карта, Telegram магазина).
// В Telegram открывается через Telegram, в браузере — в новой вкладке.
export default function ExternalLink({ href, onClick: onOpen, ...props }) {
  function onClick(event) {
    onOpen?.(event)
    if (openExternalLink(href)) event.preventDefault()
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} {...props} />
}
