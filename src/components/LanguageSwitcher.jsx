import { LANGUAGES, useI18n } from '../lib/i18n.jsx'

// Переключатель языка: две кнопки UZ и RU.
export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()

  return (
    <div className="lang-switcher" role="group" aria-label={t('language.label')}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className={code === language ? 'lang-button active' : 'lang-button'}
          aria-pressed={code === language}
          onClick={() => setLanguage(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
