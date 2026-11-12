import { useI18n } from '../lib/i18n.jsx'
import ExternalLink from './ExternalLink.jsx'
import Icon from './Icon.jsx'
import OpenStatus from './OpenStatus.jsx'

// Где магазин и как с ним связаться: ориентир и адрес, «Открыто до …»,
// кнопки «Позвонить», «Открыть на карте» (Яндекс Карты) и Telegram магазина.
export default function ShopInfo({ shop }) {
  const { language, t } = useI18n()
  const place = [shop[`landmark_${language}`], shop[`address_${language}`]].filter(Boolean).join(' · ')
  const mapUrl =
    shop.latitude && shop.longitude ? `https://yandex.uz/maps/?pt=${shop.longitude},${shop.latitude}&z=17&l=map` : null

  return (
    <>
      {place && (
        <p className="shop-place">
          <Icon name="pin" />
          {place}
        </p>
      )}
      <OpenStatus opensAt={shop.opens_at} closesAt={shop.closes_at} />
      <div className="shop-actions">
        {shop.phone && (
          <a href={`tel:${shop.phone.replace(/\s/g, '')}`} className="secondary-button">
            <Icon name="phone" />
            {t('shop.call')}
          </a>
        )}
        {mapUrl && (
          <ExternalLink href={mapUrl} className="secondary-button">
            <Icon name="map" />
            {t('shop.map')}
          </ExternalLink>
        )}
        {shop.telegram_username && (
          <ExternalLink href={`https://t.me/${shop.telegram_username}`} className="secondary-button">
            {t('shop.telegram')}
          </ExternalLink>
        )}
      </div>
    </>
  )
}
