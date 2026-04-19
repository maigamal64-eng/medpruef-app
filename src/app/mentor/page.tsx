"use client";
import { useState, useEffect } from "react";
import { Brain, MessageSquare, BarChart3, Calendar, GraduationCap, Bell, CheckCircle2 } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { getLang } from "@/lib/i18n";

export default function MentorPage() {
  const [notified, setNotified] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if user has already requested notifications
    if (typeof window !== 'undefined') {
      const existing = localStorage.getItem('medpruef_mentor_notify');
      if (existing) {
        const data = JSON.parse(existing);
        setNotified(data.notified === true);
      }
    }
  }, []);

  const handleNotifyMe = async () => {
    setLoading(true);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Store notification preference
    if (typeof window !== 'undefined') {
      const data = {
        notified: true,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('medpruef_mentor_notify', JSON.stringify(data));
    }
    
    setNotified(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom">
      {/* Header */}
      <div className="px-4 pt-8 pb-6 bg-gradient-to-b from-[var(--mp-viridian)]/5 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/20 flex items-center justify-center text-3xl mx-auto mb-4">
            🧠
          </div>
          <h1 className="text-2xl font-bold text-[var(--mp-fg)] mb-2">KI-Mentor</h1>
          <p className="text-[var(--mp-fg-muted)]">Dein persönlicher Assistent für die Prüfungsvorbereitung</p>
        </div>
      </div>

      <div className="px-4 pb-20 max-w-4xl mx-auto">
        {/* Coming Soon Badge */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 bg-[var(--mp-warning-bg)] border border-[var(--mp-status-warning)]/30 rounded-full px-4 py-2 text-sm font-medium text-[var(--mp-status-warning)]">
            <Calendar className="w-4 h-4" />
            Kommt bald: Q2 2024
          </div>
        </div>

        {/* Features Preview */}
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-[var(--mp-fg)] mb-4">Was erwartet dich?</h2>
            
            <div className="grid md:grid-cols-2 gap-6 stagger">
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[var(--mp-viridian)]/10 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-[var(--mp-viridian)]" />
                  </div>
                  <h3 className="font-semibold text-[var(--mp-fg)]">Chat-basiertes Lernen</h3>
                </div>
                <p className="text-[var(--mp-fg-muted)] text-sm">Stelle Fragen zu jedem Thema und erhalte verständliche Erklärungen mit Beispielen.</p>
              </div>
              
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[var(--mp-status-warning)]/10 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-[var(--mp-status-warning)]" />
                  </div>
                  <h3 className="font-semibold text-[var(--mp-fg)]">Schwächenanalyse</h3>
                </div>
                <p className="text-[var(--mp-fg-muted)] text-sm">Automatische Erkennung deiner Lernlücken und personalisierte Wiederholungsvorschläge.</p>
              </div>
              
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[var(--mp-accent-teal)]/10 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-[var(--mp-accent-teal)]" />
                  </div>
                  <h3 className="font-semibold text-[var(--mp-fg)]">Mündliche Simulation</h3>
                </div>
                <p className="text-[var(--mp-fg-muted)] text-sm">Übe mündliche Prüfungen mit KI-simulierten Prüfern und realistischen Fallbeispielen.</p>
              </div>
              
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[var(--mp-error)]/10 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-[var(--mp-error)]" />
                  </div>
                  <h3 className="font-semibold text-[var(--mp-fg)]">Adaptives Lernen</h3>
                </div>
                <p className="text-[var(--mp-fg-muted)] text-sm">Der Mentor passt sich deinem Lerntempo und -stil an für maximale Effizienz.</p>
              </div>
            </div>
          </div>

          {/* Notification Section */}
          <div className="card p-8 text-center">
            {!notified ? (
              <>
                <Bell className="w-12 h-12 text-[var(--mp-viridian)] mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-[var(--mp-fg)] mb-2">Benachrichtigung erhalten</h3>
                <p className="text-[var(--mp-fg-muted)] mb-6">Lass dich benachrichtigen, sobald der KI-Mentor verfügbar ist.</p>
                <button
                  onClick={handleNotifyMe}
                  disabled={loading}
                  className="inline-flex items-center gap-2 bg-[var(--mp-viridian)] hover:bg-[var(--mp-accent-teal)] text-white px-6 py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Speichere..." : "Benachrichtige mich"}
                </button>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-12 h-12 text-[var(--mp-accent-teal)] mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-[var(--mp-fg)] mb-2">Du wirst benachrichtigt!</h3>
                <p className="text-[var(--mp-fg-muted)]">Wir melden uns, sobald der KI-Mentor bereit ist.</p>
              </>
            )}
          </div>

          {/* Preview Features */}
          <div className="card p-6">
            <h3 className="font-semibold text-[var(--mp-fg)] mb-4">Erste Features</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--mp-status-warning)] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  💡
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--mp-oxford-blue)] mb-1">Post-Answer Explanations</h3>
                  <p className="text-gray-600 text-sm">Nach jeder Frage erhältst du detaillierte Erklärungen — auch bei richtigen Antworten.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--mp-viridian)] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  ✓
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--mp-oxford-blue)] mb-1">Automatische Schwächenerkennung</h3>
                  <p className="text-gray-600 text-sm">Der Mentor erkennt deine schwachen Themenbereiche und schlägt gezieltes Wiederholen vor.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--mp-accent-teal)] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  🔮
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--mp-oxford-blue)] mb-1">Mündliche Prüfung mit KI (Premium)</h3>
                  <p className="text-gray-600 text-sm">Simuliere komplette mündliche Prüfungen mit KI-generierten Fällen und realistischem Prüferfeedback.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <BottomNav lang={getLang()} />
    </div>
  );
}