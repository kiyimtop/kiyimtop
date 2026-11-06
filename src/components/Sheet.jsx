import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n.jsx'
import { setTelegramBackButton } from '../lib/platform.js'
import Icon from './Icon.jsx'

// Шторка снизу поверх страницы: список категорий, фильтры, сортировка.
// Закрывается крестиком, нажатием на тёмный фон, клавишей Esc, а в Telegram — его кнопкой «Назад».
// footer — кнопки внизу шторки, которые видны всегда (например, «Показать»).
export default function Sheet({ open, onClose, title, children, footer, className = '' }) {
  const { t } = useI18n()
  const titleId = useId()
  const sheetRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Открыли: фокус на шторку (без рамки вокруг крестика, даже если шторка открылась сама);
  // закрыли — фокус обратно на кнопку, которая открыла шторку.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const close = () => onCloseRef.current()
    sheetRef.current?.focus({ preventScroll: true })
    const onKey = (event) => event.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    const removeTelegramBack = setTelegramBackButton(close)
    return () => {
      document.removeEventListener('keydown', onKey)
      removeTelegramBack()
      opener?.focus?.({ preventScroll: true })
    }
  }, [open])

  // Шторка — поверх всей страницы, поэтому выносим её в конец страницы.
  return createPortal(
    <>
      <div className={open ? 'sheet-backdrop on' : 'sheet-backdrop'} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`sheet${open ? ' on' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        inert={!open}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="sheet-close" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}
