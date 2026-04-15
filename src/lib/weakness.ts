/**
 * Task 3b: Weakness detection library
 * Track per-topic accuracy from localStorage quiz history
 */

export interface TopicStats {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface QuizResult {
  topic: string;
  questionId: string;
  correct: boolean;
  timestamp: string;
}

/**
 * Get quiz history from localStorage
 */
function getQuizHistory(): QuizResult[] {
  if (typeof window === 'undefined') return [];
  
  try {
    // Collect from various localStorage keys that might contain quiz data
    const results: QuizResult[] = [];
    
    // Check last session data
    const lastSession = localStorage.getItem("medpruef_last_session");
    if (lastSession) {
      const session = JSON.parse(lastSession);
      // This is just session progress, not detailed results
      // We'll need to track individual answers in the practice component
    }
    
    // Check for any stored quiz results
    const storedResults = localStorage.getItem("medpruef_quiz_results");
    if (storedResults) {
      const parsed = JSON.parse(storedResults);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error reading quiz history:', error);
    return [];
  }
}

/**
 * Calculate topic statistics from quiz history
 */
function calculateTopicStats(): TopicStats[] {
  const history = getQuizHistory();
  const topicMap = new Map<string, { correct: number; total: number }>();
  
  for (const result of history) {
    const existing = topicMap.get(result.topic) || { correct: 0, total: 0 };
    existing.total += 1;
    if (result.correct) {
      existing.correct += 1;
    }
    topicMap.set(result.topic, existing);
  }
  
  const stats: TopicStats[] = [];
  for (const [topic, data] of topicMap.entries()) {
    stats.push({
      topic,
      correct: data.correct,
      total: data.total,
      accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
    });
  }
  
  return stats.sort((a, b) => b.total - a.total); // Sort by total questions answered
}

/**
 * Get weak topics (accuracy < 60% with at least 5 questions answered)
 */
export function getWeakTopics(): TopicStats[] {
  const stats = calculateTopicStats();
  return stats.filter(stat => stat.accuracy < 60 && stat.total >= 5);
}

/**
 * Get strength topics (accuracy > 80% with at least 5 questions answered)
 */
export function getStrengthTopics(): TopicStats[] {
  const stats = calculateTopicStats();
  return stats.filter(stat => stat.accuracy > 80 && stat.total >= 5);
}

/**
 * Get all topic statistics
 */
export function getAllTopicStats(): TopicStats[] {
  return calculateTopicStats();
}

/**
 * Add a quiz result to the history
 */
export function addQuizResult(topic: string, questionId: string, correct: boolean) {
  if (typeof window === 'undefined') return;
  
  try {
    const history = getQuizHistory();
    const newResult: QuizResult = {
      topic,
      questionId,
      correct,
      timestamp: new Date().toISOString(),
    };
    
    history.push(newResult);
    
    // Keep only the last 1000 results to prevent localStorage bloat
    const limited = history.slice(-1000);
    
    localStorage.setItem("medpruef_quiz_results", JSON.stringify(limited));
  } catch (error) {
    console.error('Error saving quiz result:', error);
  }
}

/**
 * Record an answer (alias for addQuizResult)
 */
export function recordAnswer(topic: string, correct: boolean) {
  // Use a random question ID since we don't have the actual questionId
  const questionId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  addQuizResult(topic, questionId, correct);
}

// generateMockData() was removed 2026-04-15 (Frontend audit P2-5).
// It was dev-only demo data that shipped in the production client
// bundle. Never called from production code paths.