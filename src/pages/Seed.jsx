import { useState } from 'react'
import { isConfigured, writeDocuments } from '../lib/firebase.js'
import { useI18n } from '../lib/i18n.jsx'

// /seed — загрузить тестовые магазины и товары в новую базу Firebase одной кнопкой
// (в Firebase нет окна, куда можно вставить файл, как SQL Editor в Supabase).
// Работает, только пока база в «тестовом режиме» (Start in test mode). После того как
// владелец вставит настоящие правила (firebase/firestore.rules), запись отсюда запрещена.
// Данные — src/seed/demoData.json (11 категорий, 8 магазинов «(demo)», товары с размерами);
// загружаются, только когда открыта эта страница. Повторно запускать не страшно — те же записи перезапишутся.
export default function Seed() {
  const { t } = useI18n()
  const [state, setState] = useState({ status: 'idle' })

  async function upload() {
    setState({ status: 'working' })
    try {
      const { default: data } = await import('../seed/demoData.json')
      const items = [
        ...data.categories.map((row) => ({ collection: 'categories', id: row.id, data: row })),
        ...data.shops.map((row) => ({ collection: 'shops', id: row.id, data: row })),
        ...data.products.map((row) => ({ collection: 'products', id: row.id, data: row })),
      ]
      // Firestore принимает до 500 записей за раз.
      for (let i = 0; i < items.length; i += 400) await writeDocuments(items.slice(i, i + 400))
      setState({ status: 'done', counts: { c: data.categories.length, s: data.shops.length, p: data.products.length } })
    } catch (error) {
      console.error('seed:', error)
      setState({ status: 'error', denied: error.status === 403 })
    }
  }

  return (
    <section className="seed">
      <h1 className="seed-title">{t('seed.title')}</h1>
      {!isConfigured ? (
        <p className="seed-text">{t('seed.notConfigured')}</p>
      ) : (
        <>
          <p className="seed-text">{t('seed.text')}</p>
          <button className="primary-button" onClick={upload} disabled={state.status === 'working'}>
            {state.status === 'working' ? t('seed.working') : t('seed.button')}
          </button>
          {state.status === 'done' && (
            <p className="seed-text seed-ok">{t('seed.done', { c: state.counts.c, s: state.counts.s, p: state.counts.p })}</p>
          )}
          {state.status === 'error' && <p className="seed-text seed-error">{t(state.denied ? 'seed.denied' : 'seed.error')}</p>}
        </>
      )}
    </section>
  )
}
