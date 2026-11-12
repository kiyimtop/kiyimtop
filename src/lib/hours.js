// Часы работы магазина по ташкентскому времени (UTC+5, без перехода на летнее время).
const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesNowInTashkent() {
  const now = new Date()
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + 5 * 60) % (24 * 60)
}

// { open: true/false, opens: '10:00', closes: '21:00' } или null, если часы не указаны.
export function openStatus(opensAt, closesAt) {
  if (!opensAt || !closesAt) return null
  const now = minutesNowInTashkent()
  const opens = toMinutes(opensAt)
  const closes = toMinutes(closesAt)
  // Магазин может работать после полуночи (закрывается раньше, чем открывается).
  const open = opens < closes ? now >= opens && now < closes : now >= opens || now < closes
  return { open, opens: opensAt.slice(0, 5), closes: closesAt.slice(0, 5) }
}
