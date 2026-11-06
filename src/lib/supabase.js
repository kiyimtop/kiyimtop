import { createClient } from '@supabase/supabase-js'

// Подключение к базе Supabase. Адрес и публичный ключ берутся из настроек
// (.env на компьютере или Environment Variables на Vercel) — в коде их нет.
// Если настроек нет, supabase = null, и сайт покажет понятное сообщение вместо поломки.
const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = url && publishableKey ? createClient(url, publishableKey) : null
