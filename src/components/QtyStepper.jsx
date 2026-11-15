import { useI18n } from '../lib/i18n.jsx'

// «− 2 +» — сколько штук. max — сколько можно (наличие и не больше 5).
export default function QtyStepper({ value, max, onChange, disabled }) {
  const { t } = useI18n()
  return (
    <div className="qty-stepper" role="group" aria-label={t('cart.qty')}>
      <button type="button" aria-label={t('cart.less')} disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={t('cart.more')} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}
