import { formatPhone } from '../lib/auth.js'

// Поле телефона (как в TheStarth): сразу стоит код Узбекистана +998, номер сам разбивается
// на группы «+998 90 123 45 67». Номер другой страны можно вписать целиком с «+».
// value / onChange — текст как на экране; сохранять через normalizePhone() из lib/auth.js.
export const PHONE_START = '+998 '

export function typePhone(text) {
  const raw = String(text ?? '')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return PHONE_START
  if (digits.startsWith('998')) return formatPhone(digits.slice(0, 12))
  if (raw.trim().startsWith('+')) return `+${digits.slice(0, 15)}`
  // Набрали номер без кода (90 123 45 67) — подставляем +998.
  return formatPhone(`998${digits}`.slice(0, 12))
}

export default function PhoneInput({ value, onChange, ...rest }) {
  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value || PHONE_START}
      onChange={(event) => onChange(typePhone(event.target.value))}
      onFocus={(event) => {
        const end = event.target.value.length
        requestAnimationFrame(() => event.target.setSelectionRange?.(end, end))
      }}
      maxLength={20}
      {...rest}
    />
  )
}
