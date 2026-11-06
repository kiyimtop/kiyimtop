import { colorHex } from '../lib/colors.js'
import { countFilters, SORTS } from '../lib/filters.js'
import { formatNumber, useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import Sheet from './Sheet.jsx'

// Шторка «Фильтры» на странице категории. Выбор применяется сразу (список под шторкой
// обновляется), кнопка внизу показывает, сколько товаров найдено, и закрывает шторку.
// options — что вообще есть в этой категории: для кого, цены, цвета, бренды, районы.
export function FilterSheet({ open, onClose, query, onChange, onReset, options, count }) {
  const { language, t, formatPrice } = useI18n()
  const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

  const priceLabel = (range) =>
    range.min === null
      ? t('filter.upTo', { price: formatPrice(range.max) })
      : range.max === null
        ? t('filter.from', { price: formatPrice(range.min) })
        : t('filter.between', { from: formatNumber(range.min), to: formatPrice(range.max) })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('filter.title')}
      footer={
        <>
          <button type="button" className="sheet-reset" onClick={onReset} disabled={countFilters(query) === 0}>
            {t('filter.reset')}
          </button>
          <button type="button" className="sheet-apply" onClick={onClose}>
            {count > 0 ? t('filter.show', { n: count }) : t('filter.nothing')}
          </button>
        </>
      }
    >
      {options.genders.length > 0 && (
        <FilterGroup title={t('filter.gender')}>
          <button type="button" className="chip" aria-pressed={!query.gender} onClick={() => onChange({ gender: null })}>
            {t('filter.all')}
          </button>
          {options.genders.map((gender) => (
            <button
              key={gender}
              type="button"
              className="chip"
              aria-pressed={query.gender === gender}
              onClick={() => onChange({ gender: query.gender === gender ? null : gender })}
            >
              {t(`gender.${gender}`)}
            </button>
          ))}
        </FilterGroup>
      )}

      <FilterGroup title={t('filter.price')} wrap={false}>
        <div className="price-fields">
          <PriceField
            label={t('filter.priceMin')}
            value={query.min}
            placeholder={options.lowest}
            onChange={(min) => onChange({ min })}
          />
          <span className="price-dash" aria-hidden="true">
            –
          </span>
          <PriceField
            label={t('filter.priceMax')}
            value={query.max}
            placeholder={options.highest}
            onChange={(max) => onChange({ max })}
          />
        </div>
        {options.priceRanges.length > 0 && (
          <div className="chip-wrap">
            {options.priceRanges.map((range) => {
              const active = query.min === range.min && query.max === range.max
              return (
                <button
                  key={`${range.min}-${range.max}`}
                  type="button"
                  className="chip"
                  aria-pressed={active}
                  onClick={() => onChange(active ? { min: null, max: null } : range)}
                >
                  {priceLabel(range)}
                </button>
              )
            })}
          </div>
        )}
      </FilterGroup>

      {options.colors.length > 0 && (
        <FilterGroup title={t('product.color')}>
          {options.colors.map((color) => (
            <button
              key={color.uz}
              type="button"
              className="chip color-chip"
              aria-pressed={query.colors.includes(color.uz)}
              onClick={() => onChange({ colors: toggle(query.colors, color.uz) })}
            >
              <span className="color-dot" style={{ background: colorHex(color.uz) }} />
              {color[language]}
            </button>
          ))}
        </FilterGroup>
      )}

      {options.brands.length > 0 && (
        <FilterGroup title={t('filter.brand')}>
          {options.brands.map((brand) => (
            <button
              key={brand}
              type="button"
              className="chip"
              aria-pressed={query.brands.includes(brand)}
              onClick={() => onChange({ brands: toggle(query.brands, brand) })}
            >
              {brand}
            </button>
          ))}
        </FilterGroup>
      )}

      {options.districts.length > 0 && (
        <FilterGroup title={t('filter.district')}>
          {options.districts.map((district) => (
            <button
              key={district}
              type="button"
              className="chip"
              aria-pressed={query.districts.includes(district)}
              onClick={() => onChange({ districts: toggle(query.districts, district) })}
            >
              {t(`district.${district}`)}
            </button>
          ))}
        </FilterGroup>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={query.openNow}
        className="switch-row"
        onClick={() => onChange({ openNow: !query.openNow })}
      >
        <span className="switch-label">
          <Icon name="clock" />
          {t('filter.openNow')}
        </span>
        <span className="switch" aria-hidden="true" />
      </button>
    </Sheet>
  )
}

function FilterGroup({ title, children, wrap = true }) {
  return (
    <section className="filter-group" role="group" aria-label={title}>
      <h3 className="filter-label">{title}</h3>
      {wrap ? <div className="chip-wrap">{children}</div> : children}
    </section>
  )
}

// Поле цены: только цифры, показываем с пробелами (150 000).
function PriceField({ label, value, placeholder, onChange }) {
  return (
    <label className="price-field">
      <span className="price-field-label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value === null ? '' : formatNumber(value)}
        placeholder={placeholder ? formatNumber(placeholder) : ''}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 9)
          onChange(digits ? Number(digits) : null)
        }}
      />
    </label>
  )
}

// Шторка «Сортировка». «Сначала ближе» спрашивает место пользователя (один раз за посещение).
// «Самые популярные» и «С высоким рейтингом» появятся после бронирования и отзывов.
export function SortSheet({ open, onClose, sort, onChoose, locating, locationFailed }) {
  const { t } = useI18n()
  return (
    <Sheet open={open} onClose={onClose} title={t('sort.title')}>
      <div className="sort-list" role="radiogroup" aria-label={t('sort.title')}>
        {SORTS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={sort === option}
            className="sort-option"
            disabled={locating}
            onClick={() => onChoose(option)}
          >
            <span className="sort-text">
              {t(`sort.${option}`)}
              {option === 'near' && (
                <span className="sort-hint">{locating ? t('sort.locating') : t('sort.nearHint')}</span>
              )}
            </span>
            {sort === option && <Icon name="check" />}
          </button>
        ))}
      </div>
      {locationFailed && (
        <p className="sort-error" role="alert">
          {t('sort.noLocation')}
        </p>
      )}
    </Sheet>
  )
}
