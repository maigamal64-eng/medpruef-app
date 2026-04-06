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
    <div className="min-h-screen bg-[#F7F9FC] safe-area-top safe-area-bottom">
      {/* Header */}
      <div className="px-4 pt-8 pb-6 bg-gradient-to-b from-[#007B5F]/5 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <div className="w-16 h-16 rounded-full bg-[#007B5F]/10 border border-[#007B5F]/20 flex items-center justify-center text-3xl mx-auto mb-4">
            🧠
          </div>
          <h1 className="text-2xl font-bold text-[#1A2B3C] mb-2">KI-Mentor</h1>
          <p className="text-[#4A5568]">Dein persönlicher Assistent für die Prüfungsvorbereitung</p>
        </div>
      </div>

      <div className="px-4 pb-20 max-w-4xl mx-auto">
        {/* Coming Soon Badge */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 bg-[#FFF4E6] border border-[#F4A261]/30 rounded-full px-4 py-2 text-sm font-medium text-[#B8860B]">
            <Calendar className="w-4 h-4" />
            Kommt bald: Q2 2024
          </div>
        </div>

        {/* Features Preview */}
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-[#1A2B3C] mb-4">Was erwartet dich?</h2>
            
            <div className="grid md:grid-cols-2 gap-6 stagger">
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[#007B5F]/10 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-[#007B5F]" />
                  </div>
                  <h3 className="font-semibold text-[#1A2B3C]">Chat-basiertes Lernen</h3>
                </div>
                <p className="text-[#4A5568] text-sm">Stelle Fragen zu jedem Thema und erhalte verständliche Erklärungen mit Beispielen.</p>
              </div>
              
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[#F4A261]/10 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-[#F4A261]" />
                  </div>
                  <h3 className="font-semibold text-[#1A2B3C]">Schwächenanalyse</h3>
                </div>
                <p className="text-[#4A5568] text-sm">Automatische Erkennung deiner Lernlücken und personalisierte Wiederholungsvorschläge.</p>
              </div>
              
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[#00A896]/10 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-[#00A896]" />
                  </div>
                  <h3 className="font-semibold text-[#1A2B3C]">Mündliche Simulation</h3>
                </div>
                <p className="text-[#4A5568] text-sm">Übe mündliche Prüfungen mit KI-simulierten Prüfern und realistischen Fallbeispielen.</p>
              </div>
              
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[#D64545]/10 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-[#D64545]" />
                  </div>
                  <h3 className="font-semibold text-[#1A2B3C]">Adaptives Lernen</h3>
                </div>
                <p className="text-[#4A5568] text-sm">Der Mentor passt sich deinem Lerntempo und -stil an für maximale Effizienz.</p>
              </div>
            </div>
          </div>

          {/* Notification Section */}
          <div className="card p-8 text-center">
            {!notified ? (
              <>
                <Bell className="w-12 h-12 text-[#007B5F] mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-[#1A2B3C] mb-2">Benachrichtigung erhalten</h3>
                <p className="text-[#4A5568] mb-6">Lass dich benachrichtigen, sobald der KI-Mentor verfügbar ist.</p>
                <button
                  onClick={handleNotifyMe}
                  disabled={loading}
                  className="inline-flex items-center gap-2 bg-[#007B5F] hover:bg-[#00A896] text-white px-6 py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Speichere..." : "Benachrichtige mich"}
                </button>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-12 h-12 text-[#00A896] mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-[#1A2B3C] mb-2">Du wirst benachrichtigt!</h3>
                <p className="text-[#4A5568]">Wir melden uns, sobald der KI-Mentor bereit ist.</p>
              </>
            )}
          </div>

          {/* Preview Features */}
          <div className="card p-6">
            <h3 className="font-semibold text-[#1A2B3C] mb-4">Erste Features</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[#F4A261] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  💡
                </div>
                <div>
                  <h3 className="font-semibold text-[#001B3D] mb-1">Post-Answer Explanations</h3>
                  <p className="text-gray-600 text-sm">Nach jeder Frage erhältst du detaillierte Erklärungen — auch bei richtigen Antworten.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[#007B5F] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  ✓
                </div>
                <div>
                  <h3 className="font-semibold text-[#001B3D] mb-1">Automatische Schwächenerkennung</h3>
                  <p className="text-gray-600 text-sm">Der Mentor erkennt deine schwachen Themenbereiche und schlägt gezieltes Wiederholen vor.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[#00A896] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  🔮
                </div>
                <div>
                  <h3 className="font-semibold text-[#001B3D] mb-1">Mündliche Prüfung mit KI (Premium)</h3>
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