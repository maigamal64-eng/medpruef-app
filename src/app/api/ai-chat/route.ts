import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — Check for cached AI explanation for a question
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const questionId = url.searchParams.get('questionId')
    if (!questionId) return NextResponse.json({ cached: false })

    const db = getServiceClient()
    const { data } = await db
      .from('questions')
      .select('ai_explanation, ai_explanation_generated_at')
      .eq('id', parseInt(questionId))
      .single()

    if (data?.ai_explanation) {
      return NextResponse.json({ cached: true, explanation: data.ai_explanation })
    }
    return NextResponse.json({ cached: false })
  } catch {
    return NextResponse.json({ cached: false })
  }
}

// POST — Generate AI explanation (and cache it)
export async function POST(req: NextRequest) {
  try {
    const { system, messages, questionId } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    let reply = ''

    // Try Anthropic Claude API first
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: system || 'You are a helpful medical exam tutor.',
          messages: messages.map((m: { role: string; content: string }) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        reply = data.content?.[0]?.text || ''
      }
    }

    // Try OpenAI if Anthropic didn't work
    if (!reply) {
      const openaiKey = process.env.OPENAI_API_KEY
      if (openaiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1024,
            messages: [
              { role: 'system', content: system || 'You are a helpful medical exam tutor.' },
              ...messages,
            ],
          }),
        })

        if (response.ok) {
          const data = await response.json()
          reply = data.choices?.[0]?.message?.content || ''
        }
      }
    }

    if (!reply) {
      return NextResponse.json({
        reply: 'KI-Assistent ist noch nicht konfiguriert.',
      })
    }

    // Cache the initial explanation (only for first message = auto-generated explanation)
    if (questionId && messages.length === 1) {
      try {
        const db = getServiceClient()
        await db.from('questions').update({
          ai_explanation: reply,
          ai_explanation_generated_at: new Date().toISOString(),
        }).eq('id', questionId)
      } catch { /* cache failure is non-critical */ }
    }

    return NextResponse.json({ reply })
  } catch (error) {
    console.error('AI chat error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
