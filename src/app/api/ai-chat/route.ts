import { NextRequest, NextResponse } from 'next/server'

/**
 * AI Chat endpoint — proxies to OpenAI-compatible API for medical question explanations.
 * Uses the Anthropic Claude API via the configured provider.
 * Falls back gracefully if no API key is configured.
 */
export async function POST(req: NextRequest) {
  try {
    const { system, messages } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

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
        const reply = data.content?.[0]?.text || ''
        return NextResponse.json({ reply })
      }
    }

    // Try OpenAI-compatible API
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
        const reply = data.choices?.[0]?.message?.content || ''
        return NextResponse.json({ reply })
      }
    }

    // No API key configured — return a helpful fallback
    return NextResponse.json({
      reply: 'KI-Assistent ist noch nicht konfiguriert. Bitte ANTHROPIC_API_KEY oder OPENAI_API_KEY in den Umgebungsvariablen hinterlegen.\n\nAI assistant is not yet configured. Please set ANTHROPIC_API_KEY or OPENAI_API_KEY in environment variables.',
    })
  } catch (error) {
    console.error('AI chat error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
