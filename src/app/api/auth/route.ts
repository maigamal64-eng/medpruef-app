import { NextRequest, NextResponse } from 'next/server'
import { validateInitData, validateLoginWidget } from '@/lib/telegram'
import { getServiceClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { initData, widgetData, tokenExchange, emailLogin, emailRegister } = body
    const botToken = process.env.TELEGRAM_BOT_TOKEN!
    const sb = getServiceClient()

    // ── EMAIL/PASSWORD LOGIN ──
    if (emailLogin) {
      const { email, password } = emailLogin
      if (!email || !password) {
        return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
      }

      const { data: user, error } = await sb
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle()

      if (error || !user) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
      if (!user.password_hash) {
        return NextResponse.json({ error: 'This account uses Telegram login' }, { status: 401 })
      }

      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      // Ensure gamification record
      await sb.from('user_gamification').upsert({ user_id: user.id }, { onConflict: 'user_id' })
      const { data: gamification } = await sb
        .from('user_gamification')
        .select('*')
        .eq('user_id', user.id)
        .single()

      // Log activity
      await sb.from('user_activity_log').insert({
        user_id: user.id,
        event_type: 'login',
        action: 'email_login',
        metadata: { method: 'email' },
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        user_agent: req.headers.get('user-agent') || 'unknown',
      }).then(() => {})

      return NextResponse.json({ user, gamification })
    }

    // ── EMAIL/PASSWORD REGISTER ──
    if (emailRegister) {
      const { email, password, firstName, lastName } = emailRegister
      if (!email || !password || !firstName) {
        return NextResponse.json({ error: 'Email, password, and name required' }, { status: 400 })
      }
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
      }

      // Check if email already exists
      const { data: existing } = await sb
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle()

      if (existing) {
        return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
      }

      const passwordHash = await bcrypt.hash(password, 10)

      const { data: user, error } = await sb
        .from('users')
        .insert({
          email: email.toLowerCase().trim(),
          password_hash: passwordHash,
          first_name: firstName.trim(),
          last_name: lastName?.trim() || null,
          language_code: 'de',
          role: 'user',
        })
        .select()
        .single()

      if (error) {
        console.error('Register error:', error)
        return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
      }

      // Create gamification record
      await sb.from('user_gamification').insert({ user_id: user.id })
      const { data: gamification } = await sb
        .from('user_gamification')
        .select('*')
        .eq('user_id', user.id)
        .single()

      // Log activity
      await sb.from('user_activity_log').insert({
        user_id: user.id,
        event_type: 'register',
        action: 'email_register',
        metadata: { method: 'email' },
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        user_agent: req.headers.get('user-agent') || 'unknown',
      }).then(() => {})

      return NextResponse.json({ user, gamification })
    }

    // ── TELEGRAM AUTH FLOWS ──
    let telegramUser

    if (process.env.NODE_ENV === 'development' && !initData && !widgetData && !tokenExchange) {
      telegramUser = { id: 100008, first_name: '[name]', last_name: 'Test', username: 'testdoc8', language_code: 'de' }
    } else if (initData) {
      telegramUser = validateInitData(initData, botToken)
      if (!telegramUser) {
        try {
          const params = new URLSearchParams(initData)
          const userStr = params.get('user')
          if (userStr) telegramUser = JSON.parse(userStr)
        } catch {}
      }
    } else if (widgetData) {
      telegramUser = validateLoginWidget(widgetData as Record<string, unknown>, botToken)
      if (!telegramUser && process.env.NODE_ENV === 'development') {
        telegramUser = {
          id: widgetData.id,
          first_name: widgetData.first_name,
          last_name: widgetData.last_name,
          username: widgetData.username,
          photo_url: widgetData.photo_url,
        }
      }
    } else if (tokenExchange) {
      const { data: row, error: e } = await sb
        .from('telegram_login_tokens')
        .select('*')
        .eq('token', tokenExchange)
        .maybeSingle()
      if (e) {
        console.error('Token lookup error:', e)
        return NextResponse.json({ error: 'Token lookup failed' }, { status: 500 })
      }
      if (!row) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
      if (row.used_at) return NextResponse.json({ error: 'Token already used' }, { status: 401 })
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: 'Token expired' }, { status: 401 })
      }
      await sb
        .from('telegram_login_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', tokenExchange)
      telegramUser = {
        id: Number(row.telegram_id),
        first_name: row.first_name || 'User',
        last_name: row.last_name || undefined,
        username: row.username || undefined,
        photo_url: row.photo_url || undefined,
        language_code: row.language_code || 'de',
      }
    }

    if (!telegramUser) {
      return NextResponse.json({ error: 'Invalid auth' }, { status: 401 })
    }

    // Upsert Telegram user
    const { data: user, error } = await sb
      .from('users')
      .upsert({
        telegram_id: telegramUser.id,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name || null,
        telegram_username: telegramUser.username || null,
        language_code: telegramUser.language_code || 'de',
        photo_url: telegramUser.photo_url || null,
        is_premium: telegramUser.is_premium || false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id' })
      .select()
      .single()

    if (error) {
      console.error('Upsert error:', error)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    await sb.from('user_gamification').upsert({ user_id: user.id }, { onConflict: 'user_id' })
    const { data: gamification } = await sb
      .from('user_gamification')
      .select('*')
      .eq('user_id', user.id)
      .single()

    // Log Telegram login activity
    await sb.from('user_activity_log').insert({
      user_id: user.id,
      event_type: 'login',
      action: 'telegram_login',
      metadata: { method: tokenExchange ? 'bot_deeplink' : widgetData ? 'widget' : 'miniapp' },
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      user_agent: req.headers.get('user-agent') || 'unknown',
    }).then(() => {})

    return NextResponse.json({ user, gamification })
  } catch (e: unknown) {
    console.error('Auth error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
