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
    const lastSession = localStorage.getItem("medprep_last_session");
    if (lastSession) {
      const session = JSON.parse(lastSession);
      // This is just session progress, not detailed results
      // We'll need to track individual answers in the practice component
    }
    
    // Check for any stored quiz results
    const storedResults = localStorage.getItem("medprep_quiz_results");
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
    
    localStorage.setItem("medprep_quiz_results", JSON.stringify(limited));
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

/**
 * Generate mock data for demonstration
 */
export function generateMockData() {
  if (typeof window === 'undefined') return;
  
  const topics = [
    "Innere Medizin",
    "Chirurgie", 
    "Pädiatrie",
    "Neurologie",
    "Gynäkologie",
    "Notfallmedizin",
    "Psychiatrie",
    "Orthopädie",
  ];
  
  const mockResults: QuizResult[] = [];
  
  for (const topic of topics) {
    const questionCount = Math.floor(Math.random() * 20) + 5; // 5-25 questions per topic
    
    for (let i = 0; i < questionCount; i++) {
      // Simulate different accuracy rates for different topics
      let correctChance = 0.7; // 70% default
      if (topic === "Neurologie" || topic === "Orthopädie") correctChance = 0.4; // Weak topics
      if (topic === "Innere Medizin" || topic === "Pädiatrie") correctChance = 0.85; // Strong topics
      
      mockResults.push({
        topic,
        questionId: `mock_${topic}_${i}`,
        correct: Math.random() < correctChance,
        timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }
  
  localStorage.setItem("medprep_quiz_results", JSON.stringify(mockResults));
  console.log(`Generated ${mockResults.length} mock quiz results`);
}