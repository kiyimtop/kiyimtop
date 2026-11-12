import { openStatus } from '../lib/hours.js'
import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'

// «Открыто до 21:00» (зелёным) или «Закрыто · откроется в 10:00».
export default function OpenStatus({ opensAt, closesAt }) {
  const { t } = useI18n()
  const status = openStatus(opensAt, closesAt)
  if (!status) return null
  return (
    <p className={status.open ? 'open-status open' : 'open-status'}>
      <Icon name="clock" />
      {status.open ? t('shop.openUntil', { time: status.closes }) : t('shop.closedOpensAt', { time: status.opens })}
    </p>
  )
}
