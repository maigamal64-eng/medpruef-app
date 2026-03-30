import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { calculateXP } from '@/lib/xp'

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const { userId, questionId, isCorrect, userAnswer, timeSpentMs } = await req.json()

  if (!userId || !questionId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Get question difficulty
  const { data: question } = await sb.from('questions').select('difficulty').eq('id', questionId).single()
  const difficulty = question?.difficulty || 2
  const xp = calculateXP(isCorrect, difficulty)

  // Record answer
  await sb.from('answer_history').insert({
    user_id: userId,
    question_id: questionId,
    user_answer: userAnswer || null,
    is_correct: isCorrect,
    time_spent_ms: timeSpentMs || null,
    xp_earned: xp,
  })

  // Update/create progress
  const { data: existing } = await sb
    .from('user_question_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .single()

  if (existing) {
    const newEase = isCorrect 
      ? Math.min(3.0, existing.ease_factor + 0.1)
      : Math.max(1.3, existing.ease_factor - 0.2)
    const newInterval = isCorrect 
      ? Math.max(1, Math.round(existing.interval_days * newEase))
      : 0
    const nextReview = new Date()
    nextReview.setDate(nextReview.getDate() + newInterval)

    await sb.from('user_question_progress').update({
      times_seen: existing.times_seen + 1,
      times_correct: existing.times_correct + (isCorrect ? 1 : 0),
      ease_factor: newEase,
      interval_days: newInterval,
      next_review_at: nextReview.toISOString(),
      last_seen_at: new Date().toISOString(),
    }).eq('id', existing.id)
  } else {
    const nextReview = new Date()
    nextReview.setDate(nextReview.getDate() + (isCorrect ? 1 : 0))
    await sb.from('user_question_progress').insert({
      user_id: userId,
      question_id: questionId,
      times_seen: 1,
      times_correct: isCorrect ? 1 : 0,
      ease_factor: isCorrect ? 2.6 : 2.3,
      interval_days: isCorrect ? 1 : 0,
      next_review_at: nextReview.toISOString(),
      last_seen_at: new Date().toISOString(),
    })
  }

  // Update gamification
  const today = new Date().toISOString().split('T')[0]
  const { data: gam } = await sb.from('user_gamification').select('*').eq('user_id', userId).single()
  
  if (gam) {
    const isNewDay = gam.daily_reset_date !== today
    const newStreak = gam.last_study_date === new Date(Date.now() - 86400000).toISOString().split('T')[0]
      ? gam.current_streak + (isNewDay ? 1 : 0)
      : isNewDay ? 1 : gam.current_streak

    await sb.from('user_gamification').update({
      total_questions_answered: gam.total_questions_answered + 1,
      total_correct: gam.total_correct + (isCorrect ? 1 : 0),
      total_xp: gam.total_xp + xp,
      current_streak: newStreak,
      longest_streak: Math.max(gam.longest_streak, newStreak),
      last_study_date: today,
      daily_questions_today: isNewDay ? 1 : gam.daily_questions_today + 1,
      daily_reset_date: today,
    }).eq('user_id', userId)
  }

  // Update user XP
  await sb.from('users').update({
    xp_total: (gam?.total_xp || 0) + xp,
    last_active_date: today,
  }).eq('id', userId)

  return NextResponse.json({ xp, totalXp: (gam?.total_xp || 0) + xp })
}
